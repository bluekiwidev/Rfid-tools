def _make_text_record(payload_bytes, lang='en'):
    # NDEF Text record: [TNF=1 short record] header, type len, payload len, type 'T', payload
    lang_bytes = lang.encode('ascii')
    status = len(lang_bytes) & 0x3F
    nlen = len(payload_bytes) + 1 + len(lang_bytes)
    header = 0xD1  # MB=1, ME=1, SR=1, TNF=0x01 (well-known)
    return bytes([header, 0x01, nlen, 0x54, status]) + lang_bytes + payload_bytes


def ndef_message_to_blocks(payload_bytes, text=False):
    """Create MIFARE Classic 16-byte block list for an NDEF TLV starting at some block.
    If text=True treat payload_bytes as UTF-8 text payload and wrap as NDEF Text record.
    Returns a list of lists (each 16 ints).
    """
    if text:
        ndef = _make_text_record(payload_bytes)
    else:
        # raw NDEF payload already
        ndef = payload_bytes

    # TLV: 0x03 length NDEF ... 0xFE
    tlv = bytes([0x03])
    l = len(ndef)
    if l < 0xFF:
        tlv += bytes([l])
    else:
        # long format not implemented; keep simple
        tlv += bytes([0xFF]) + bytes([(l >> 8) & 0xFF, l & 0xFF])
    tlv += ndef
    tlv += bytes([0xFE])

    # pad to 16-byte boundaries
    blocks = []
    for i in range(0, len(tlv), 16):
        chunk = tlv[i:i+16]
        chunk = chunk + bytes([0x00] * (16 - len(chunk)))
        blocks.append([b for b in chunk])
    if not blocks:
        blocks = [[0]*16]
    return blocks
