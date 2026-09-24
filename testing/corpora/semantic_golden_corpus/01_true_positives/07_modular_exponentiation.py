def encrypt_num(m, e, n):
    res = 1
    m = m % n
    while e > 0:
        if (e & 1) == 1:
            res = (res * m) % n
        e = e >> 1
        m = (m * m) % n
    return res