def str_hash(s):
    # Standard djb2 hash for a hash table (NOT crypto)
    h = 5381
    for c in s:
        h = ((h << 5) + h) + ord(c)
    return h