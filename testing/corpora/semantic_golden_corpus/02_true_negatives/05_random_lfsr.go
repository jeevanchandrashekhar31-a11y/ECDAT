func lfsr(seed uint16) uint16 {
    bit := ((seed >> 0) ^ (seed >> 2) ^ (seed >> 3) ^ (seed >> 5)) & 1
    return (seed >> 1) | (bit << 15)
}