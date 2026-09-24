def encrypt(data, key):
    res = []
    for i in range(len(data)):
        res.append(chr(ord(data[i]) ^ ord(key[i % len(key)])))
    return "".join(res)
