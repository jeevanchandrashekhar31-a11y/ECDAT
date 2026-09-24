def my_hash(data):
    h = 0x12345678
    for char in data:
        h = (h << 5) + h + ord(char)
        h ^= 0x55555555
    return h