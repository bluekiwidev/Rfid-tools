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

from utils.mfrc522 import MFRC522
from utils.mfrc522_utils import read_rfid, dump_tag, read_block, write_block, write_ndef, format_ndef
from utils.json_utils import get_tags_dict


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
                        res = dump_tag(rdr, uid)
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
                        res = read_block(rdr, uid, addr)
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
                        res = write_block(rdr, uid, addr, data)
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
                        ok = format_ndef(rdr, uid, start)
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
                        ok = write_ndef(rdr, uid, text, start)
                        send_response({"cmd": "status", "status": "write_ndef_complete", "action": "write_ndef", "ok": ok})
                        send_response({"cmd": "write_ndef", "ok": ok})

                else:
                    send_response({"error": "unknown_cmd", "cmd": action})

        except Exception as e:
            try:
                send_response({"error": "exception", "message": str(e)})
            except Exception:
                print("exception", e)
        time.sleep(delay)