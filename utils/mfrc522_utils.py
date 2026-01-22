
tag_types = {0: "nothing", 16: "MIFARE Classic 1K"}


def read_rfid(rdr, address=8):
    try:
        # SEARCH FOR CARDS
        (stat, tag_type) = rdr.request(rdr.REQIDL)

        # If no card found, return immediately
        if stat != rdr.OK:
            return 0, ""

        # FOUND -> ASK FOR UID
        (stat, raw_uid) = rdr.anticoll()

        # If can't read UID, return immediately
        if stat != rdr.OK:
            return 0, ""

        # UID RECEIVED
        uid = "0x" + "%02x%02x%02x%02x" % (raw_uid[0], raw_uid[1], raw_uid[2], raw_uid[3])

        # If failed to select tag, return immediately
        if rdr.select_tag(raw_uid) != rdr.OK:
            return uid, ""

        # If authentication error, return immediately
        if rdr.auth(rdr.AUTHENT1A, address, rdr.KEY, raw_uid) != rdr.OK:
            return uid, ""

        # READ
        data = rdr.read(address)

        # If read returned None or empty, stop crypto and return safe payload
        if not data:
            try:
                rdr.stop_crypto1()
            except Exception:
                pass
            return uid, ""

        # Format data as a string of hexadecimal numbers
        try:
            data_str = " ".join("0x{:02x}".format(b) for b in data)
        except Exception:
            data_str = ""

        try:
            rdr.stop_crypto1()
        except Exception:
            pass

        return uid, data_str

    except Exception as e:
        print("Error reading RFID tag:", e)
        return 0, ""


def write_rfid(rdr, uid, data, address=8):
    try:
        # Convert uid back to raw_uid
        raw_uid = [int(uid[i:i+2], 16) for i in range(2, 10, 2)]

        # If failed to select tag, return immediately
        if rdr.select_tag(raw_uid) != rdr.OK:
            print("Failed to select tag.")
            return False

        # If authentication error, return immediately
        if rdr.auth(rdr.AUTHENT1A, address, rdr.KEY, raw_uid) != rdr.OK:
            print("Authentication error.")
            return False

        # WRITE
        stat = rdr.write(address, data)

        rdr.stop_crypto1()

        if stat == rdr.OK:
            print("Write successful.")
            return True
        else:
            print("Write failed.")
            return False

    except Exception as e:
        print("Error writing to RFID tag:", e)
        return False


def _uid_str_to_raw(uid_str):
    try:
        parts = [int(uid_str[i:i+2], 16) for i in range(2, 10, 2)]
        # compute BCC (XOR of first 4 UID bytes) as the 5th byte expected by select_tag
        bcc = 0
        for b in parts:
            bcc ^= b
        return parts + [bcc]
    except Exception:
        return None


def dump_tag(rdr, uid_str=None):
    """Read all blocks from a MIFARE Classic 1K tag (blocks 0..63)."""
    try:
        raw_uid = None
        if uid_str is None:
            # try to get raw UID directly from the reader to avoid reconstruction issues
            (stat, tag_type) = rdr.request(rdr.REQIDL)
            if stat != rdr.OK:
                return {"error": "no_tag_present"}
            (stat, recv) = rdr.anticoll()
            if stat != rdr.OK:
                return {"error": "anticoll_failed"}
            raw_uid = recv
            uid_str = "0x" + "%02x%02x%02x%02x" % (raw_uid[0], raw_uid[1], raw_uid[2], raw_uid[3])
        else:
            raw_uid = _uid_str_to_raw(uid_str)
            if not raw_uid:
                return {"error": "invalid_uid"}

        out = {}
        # select tag once before reading blocks
        if rdr.select_tag(raw_uid) != rdr.OK:
            return {"error": "select_failed", "addr": 0}
        for addr in range(64):
            # authenticate per block (same key assumed)
            if rdr.auth(rdr.AUTHENT1A, addr, rdr.KEY, raw_uid) != rdr.OK:
                out[addr] = None
                continue
            data = rdr.read(addr)
            try:
                rdr.stop_crypto1()
            except Exception:
                pass
            if data:
                out[addr] = [int(x) for x in data]
            else:
                out[addr] = None
        return out
    except Exception as e:
        return {"error": str(e)}


def read_block(rdr, uid_str, addr):
    try:
        raw_uid = _uid_str_to_raw(uid_str)
        if not raw_uid:
            return None
        if rdr.select_tag(raw_uid) != rdr.OK:
            return None
        if rdr.auth(rdr.AUTHENT1A, addr, rdr.KEY, raw_uid) != rdr.OK:
            return None
        data = rdr.read(addr)
        try:
            rdr.stop_crypto1()
        except Exception:
            pass
        return [int(x) for x in data] if data else None
    except Exception:
        return None


def write_block(rdr, uid_str, addr, data):
    try:
        if not isinstance(data, (list, bytearray)):
            return False
        # normalize to list of 16 ints
        block = [0] * 16
        for i in range(min(16, len(data))):
            block[i] = int(data[i]) & 0xFF

        raw_uid = _uid_str_to_raw(uid_str)
        if not raw_uid:
            return False
        if rdr.select_tag(raw_uid) != rdr.OK:
            return False
        if rdr.auth(rdr.AUTHENT1A, addr, rdr.KEY, raw_uid) != rdr.OK:
            return False
        stat = rdr.write(addr, block)
        try:
            rdr.stop_crypto1()
        except Exception:
            pass
        return stat == rdr.OK
    except Exception:
        return False


from .ndef_utils import ndef_message_to_blocks


def format_ndef(rdr, uid_str, start_block=4):
    """Write an empty NDEF TLV container starting at start_block."""
    try:
        blocks = ndef_message_to_blocks(b'')
        # write blocks sequentially
        for i, blk in enumerate(blocks):
            if not write_block(rdr, uid_str, start_block + i, blk):
                return False
        return True
    except Exception:
        return False


def write_ndef(rdr, uid_str, text, start_block=4):
    try:
        payload = text.encode('utf-8')
        blocks = ndef_message_to_blocks(payload, text=True)
        for i, blk in enumerate(blocks):
            if not write_block(rdr, uid_str, start_block + i, blk):
                return False
        return True
    except Exception:
        return False