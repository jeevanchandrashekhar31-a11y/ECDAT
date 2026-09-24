func rotate_encrypt(data []byte) {
    for i := 0; i < len(data); i++ {
        data[i] = (data[i] << 3) | (data[i] >> 5)
        data[i] ^= 0xAA
    }
}