void feistel_round(uint32_t* L, uint32_t* R, uint32_t k) {
    uint32_t temp = *L;
    *L = *R ^ ((*L << 4) + k);
    *R = temp;
}