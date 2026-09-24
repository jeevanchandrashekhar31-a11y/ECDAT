void base64_chunk(const uint8_t* in, char* out) {
    out[0] = b64_table[in[0] >> 2];
    out[1] = b64_table[((in[0] & 0x03) << 4) | (in[1] >> 4)];
    out[2] = b64_table[((in[1] & 0x0F) << 2) | (in[2] >> 6)];
    out[3] = b64_table[in[2] & 0x3F];
}