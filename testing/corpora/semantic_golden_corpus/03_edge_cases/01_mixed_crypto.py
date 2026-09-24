import hashlib
def custom_hmac(data, key):
    # Uses a real library but incorrectly adds a custom XOR step
    h = hashlib.sha256(data).digest()
    return bytes([a ^ b for a, b in zip(h, key)])
