"""
circuitpython-rfid-hid
convert RFID Tag Data into keystrokes by emulating a USB Keyboard on a Pi Pico.
https://github.com/LaserBorg/circuitpython-rfid-hid
"""

import time
import board                                                    # type: ignore
import usb_hid                                                  # type: ignore
from adafruit_hid.keyboard import Keyboard                      # type: ignore
from adafruit_hid.keyboard_layout_us import KeyboardLayoutUS    # type: ignore

import json
import usb_cdc                                               # type: ignore
import os

from utils.mfrc522 import MFRC522
from utils.mfrc522_utils import read_rfid, dump_tag, read_block, write_block, write_ndef, format_ndef
from utils.json_utils import get_tags_dict
from adafruit_hid.keycode import Keycode                      # type: ignore


# SPI Pins for MFRC522
sck = board.GP18
mosi = board.GP19
miso = board.GP16 
rst = board.GP20
cs = board.GP17

# sleep between rfid scans, in seconds
delay = 0.1

# threshold how often *notfound* before leave-event, has to be >= 2
notfound_limit = 4    

if __name__ == "__main__":

    # init RFID
    rdr = MFRC522(sck, mosi, miso, rst, cs, delay=int(delay * 1000))  
    rdr.set_antenna_gain(0x07 << 4)

    # init Keyboard
    kbd = Keyboard(usb_hid.devices)  
    keyboard = KeyboardLayoutUS(kbd)

    # get RFID Tag IDs
    known_tags = get_tags_dict('known_tags.json')

    # HID mapping persistence
    HID_MAPS_FILE = 'hid_maps.json'
    HID_SETTINGS_FILE = 'hid_settings.json'

    def load_json_file(path, default):
        try:
            if not os.path.exists(path):
                return default
            with open(path, 'r') as f:
                return json.load(f)
        except Exception:
            return default

    def save_json_file(path, obj):
        try:
            with open(path, 'w') as f:
                json.dump(obj, f)
                return True
        except Exception:
            return False

    hid_maps = load_json_file(HID_MAPS_FILE, {})
    hid_settings = load_json_file(HID_SETTINGS_FILE, {"enabled": False, "enter": False})
    hid_enabled = bool(hid_settings.get('enabled', False))
    hid_enter = bool(hid_settings.get('enter', False))

    
    # SERIAL COMMAND LOOP
    # Prefer the CDC "data" interface, but fall back to the console if needed.
    usb = None
    try:
        if hasattr(usb_cdc, 'data') and usb_cdc.data.connected:
            usb = usb_cdc.data
        elif hasattr(usb_cdc, 'console') and usb_cdc.console.connected:
            usb = usb_cdc.console
        else:
            # choose data if present even when not reported connected (some hosts show single port)
            usb = getattr(usb_cdc, 'data', None) or getattr(usb_cdc, 'console', None)
    except Exception:
        usb = getattr(usb_cdc, 'data', None) or getattr(usb_cdc, 'console', None)

    def send_response(obj):
        try:
            # include current txn if present and not already provided
            if current_txn and isinstance(obj, dict) and 'txn' not in obj:
                obj['txn'] = current_txn
            s = json.dumps(obj)
        except Exception:
            s = json.dumps({"error": "serialization_failed"})
        try:
            usb.write(s.encode('utf-8') + b"\n")
        except Exception:
            print(s)
        

    def wait_for_tag(timeout=15, poll_delay=0.2, address=8):
        """Poll the reader until a tag UID is found or timeout (seconds) expires.
        Returns (uid, payload) or (None, None) on timeout.
        """
        start = time.monotonic()
        last_report = 0
        while (time.monotonic() - start) < timeout:
            uid, payload = read_rfid(rdr, address=address)
            if uid and uid != 0:
                return uid, payload
            # send periodic waiting status every 1s
            now = time.monotonic()
            if now - last_report >= 1:
                send_response({"cmd": "status", "status": "waiting_for_tag"})
                last_report = now
            time.sleep(poll_delay)
        return None, None

    print("ready")
    current_txn = None
    # HID runtime state
    hid_last_uid = None
    hid_notfound_counter = 0
    while True:
        try:
            if usb and getattr(usb, 'in_waiting', 0):
                raw = usb.readline()
                if not raw:
                    continue
                # echo raw input to main console for debugging
                try:
                    print('RECV_RAW:', raw)
                except Exception:
                    pass
                try:
                    cmd = json.loads(raw.decode('utf-8').strip())
                except Exception:
                    send_response({"error": "bad_json", "raw": raw.decode('utf-8', 'ignore')})
                    continue
                # capture txn to echo it in all responses for client-side correlation
                current_txn = cmd.get('txn')

                # handle simple commands
                action = cmd.get('cmd')
                if action == 'read_uid':
                    send_response({"cmd": "status", "status": "place_tag", "action": "read_uid"})
                    uid, payload = wait_for_tag(timeout=int(cmd.get('timeout', 15)), poll_delay=0.2, address=cmd.get('address', 8))
                    if not uid:
                        send_response({"cmd": "status", "status": "timeout", "action": "read_uid"})
                        send_response({"cmd": "read_uid", "uid": 0, "payload": ""})
                    else:
                        send_response({"cmd": "status", "status": "read_complete", "action": "read_uid", "uid": uid})
                        send_response({"cmd": "read_uid", "uid": uid, "payload": payload})

                elif action == 'dump':
                    uid = cmd.get('uid')
                    send_response({"cmd": "status", "status": "place_tag", "action": "dump"})
                    if not uid:
                        uid, _ = wait_for_tag(timeout=int(cmd.get('timeout', 15)))
                    if not uid:
                        send_response({"cmd": "status", "status": "timeout", "action": "dump"})
                        send_response({"cmd": "dump", "uid": None, "dump": None})
                    else:
                        send_response({"cmd": "status", "status": "reading", "action": "dump", "uid": uid})
                        res = dump_tag(rdr, uid, protocol=cmd.get('protocol', 'auto'), key=cmd.get('key'))
                        send_response({"cmd": "status", "status": "dump_complete", "action": "dump", "uid": uid})
                        send_response({"cmd": "dump", "uid": uid, "dump": res})

                elif action == 'read_block':
                    uid = cmd.get('uid')
                    addr = int(cmd.get('addr', 8))
                    send_response({"cmd": "status", "status": "place_tag", "action": "read_block", "addr": addr})
                    if not uid:
                        uid, _ = wait_for_tag(timeout=int(cmd.get('timeout', 15)))
                    if not uid:
                        send_response({"cmd": "status", "status": "timeout", "action": "read_block", "addr": addr})
                        send_response({"cmd": "read_block", "addr": addr, "data": None, "ok": False, "error": "timeout"})
                    else:
                        res = read_block(rdr, uid, addr, protocol=cmd.get('protocol', 'auto'), key=cmd.get('key'))
                        if isinstance(res, dict):
                            if res.get('ok'):
                                send_response({"cmd": "status", "status": "read_block_complete", "action": "read_block", "addr": addr})
                                send_response({"cmd": "read_block", "addr": addr, "data": res.get('data'), "ok": True})
                            else:
                                send_response({"cmd": "status", "status": "read_block_complete", "action": "read_block", "addr": addr})
                                send_response({"cmd": "read_block", "addr": addr, "data": None, "ok": False, "error": res.get('error'), "message": res.get('message')})
                        else:
                            send_response({"cmd": "read_block", "addr": addr, "data": res})

                elif action == 'write_block':
                    uid = cmd.get('uid')
                    addr = int(cmd.get('addr', 8))
                    data = cmd.get('data')
                    send_response({"cmd": "status", "status": "place_tag", "action": "write_block", "addr": addr})
                    if not uid:
                        uid, _ = wait_for_tag(timeout=int(cmd.get('timeout', 15)))
                    if not uid:
                        send_response({"cmd": "status", "status": "timeout", "action": "write_block", "addr": addr})
                        send_response({"cmd": "write_block", "addr": addr, "ok": False, "error": "timeout"})
                    else:
                        send_response({"cmd": "status", "status": "writing_block", "action": "write_block", "addr": addr})
                        res = write_block(rdr, uid, addr, data, protocol=cmd.get('protocol', 'auto'), key=cmd.get('key'))
                        if isinstance(res, dict):
                            send_response({"cmd": "status", "status": "write_block_complete", "action": "write_block", "addr": addr, "ok": res.get('ok', False)})
                            send_response({"cmd": "write_block", "addr": addr, "ok": res.get('ok', False), "error": res.get('error'), "message": res.get('message')})
                        else:
                            send_response({"cmd": "write_block", "addr": addr, "ok": res})

                elif action == 'format_ndef':
                    uid = cmd.get('uid')
                    start = int(cmd.get('start', 4))
                    send_response({"cmd": "status", "status": "place_tag", "action": "format_ndef"})
                    if not uid:
                        uid, _ = wait_for_tag(timeout=int(cmd.get('timeout', 15)))
                    if not uid:
                        send_response({"cmd": "status", "status": "timeout", "action": "format_ndef"})
                        send_response({"cmd": "format_ndef", "ok": False})
                    else:
                        send_response({"cmd": "status", "status": "formatting_ndef", "action": "format_ndef"})
                        ok = format_ndef(rdr, uid, start, protocol=cmd.get('protocol', 'auto'), key=cmd.get('key'))
                        send_response({"cmd": "status", "status": "format_ndef_complete", "action": "format_ndef", "ok": ok})
                        send_response({"cmd": "format_ndef", "ok": ok})

                elif action == 'write_ndef':
                    uid = cmd.get('uid')
                    text = cmd.get('text', '')
                    start = int(cmd.get('start', 4))
                    send_response({"cmd": "status", "status": "place_tag", "action": "write_ndef"})
                    if not uid:
                        uid, _ = wait_for_tag(timeout=int(cmd.get('timeout', 15)))
                    if not uid:
                        send_response({"cmd": "status", "status": "timeout", "action": "write_ndef"})
                        send_response({"cmd": "write_ndef", "ok": False})
                    else:
                        send_response({"cmd": "status", "status": "writing_ndef", "action": "write_ndef"})
                        ok = write_ndef(rdr, uid, text, start, protocol=cmd.get('protocol', 'auto'), key=cmd.get('key'))
                        send_response({"cmd": "status", "status": "write_ndef_complete", "action": "write_ndef", "ok": ok})
                        send_response({"cmd": "write_ndef", "ok": ok})

                else:
                    send_response({"error": "unknown_cmd", "cmd": action})

                # HID management commands
                if action == 'hid_list':
                    send_response({"cmd": "hid_list", "maps": hid_maps})

                elif action == 'hid_set':
                    uid = cmd.get('uid')
                    text = cmd.get('text', '')
                    if not uid:
                        send_response({"cmd": "hid_set", "ok": False, "error": "missing_uid"})
                    else:
                        hid_maps[uid] = text
                        ok = save_json_file(HID_MAPS_FILE, hid_maps)
                        send_response({"cmd": "hid_set", "ok": ok, "uid": uid, "text": text})

                elif action == 'hid_delete':
                    uid = cmd.get('uid')
                    if uid and uid in hid_maps:
                        hid_maps.pop(uid, None)
                        ok = save_json_file(HID_MAPS_FILE, hid_maps)
                        send_response({"cmd": "hid_delete", "ok": ok, "uid": uid})
                    else:
                        send_response({"cmd": "hid_delete", "ok": False, "error": "not_found", "uid": uid})

                elif action == 'hid_set_enabled':
                    enabled = bool(cmd.get('enabled', False))
                    hid_enabled = enabled
                    hid_settings['enabled'] = hid_enabled
                    ok = save_json_file(HID_SETTINGS_FILE, hid_settings)
                    send_response({"cmd": "hid_set_enabled", "ok": ok, "enabled": hid_enabled})

                elif action == 'hid_set_enter':
                    enter = bool(cmd.get('enter', False))
                    hid_enter = enter
                    hid_settings['enter'] = hid_enter
                    ok = save_json_file(HID_SETTINGS_FILE, hid_settings)
                    send_response({"cmd": "hid_set_enter", "ok": ok, "enter": hid_enter})

                elif action == 'hid_get_settings':
                    send_response({"cmd": "hid_get_settings", "enabled": hid_enabled, "enter": hid_enter})

        except Exception as e:
            try:
                send_response({"error": "exception", "message": str(e)})
            except Exception:
                print("exception", e)
        # Autonomous HID scanning: if enabled, look for tags and type mapped text once per tag
        try:
            if hid_enabled:
                uid, _ = read_rfid(rdr, address=8)
                if uid and uid != 0:
                    hid_notfound_counter = 0
                    if uid != hid_last_uid:
                        # new tag seen
                        hid_last_uid = uid
                        mapped = hid_maps.get(uid)
                        if mapped is not None:
                            # report and type
                            send_response({"cmd": "status", "status": "hid_typing", "uid": uid})
                            try:
                                keyboard.write(mapped)
                                if hid_enter:
                                    kbd.press(Keycode.ENTER)
                                    kbd.release_all()
                                send_response({"cmd": "hid_typed", "uid": uid, "text": mapped})
                            except Exception as e:
                                send_response({"cmd": "hid_error", "uid": uid, "error": str(e)})
                else:
                    # no tag present
                    hid_notfound_counter += 1
                    if hid_notfound_counter >= notfound_limit:
                        hid_last_uid = None
                        hid_notfound_counter = 0
        except Exception:
            # swallow sensor/key errors so serial stays responsive
            pass

        time.sleep(delay)