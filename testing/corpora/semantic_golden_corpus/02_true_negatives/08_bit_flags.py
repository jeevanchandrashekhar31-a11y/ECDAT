def process_flags(flags):
    if flags & 0x01:
        flags ^= 0x02
    flags = flags << 1
    return flags