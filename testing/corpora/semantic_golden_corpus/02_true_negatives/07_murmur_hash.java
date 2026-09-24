public int murmur3(int key) {
    key ^= key >>> 16;
    key *= 0x85ebca6b;
    key ^= key >>> 13;
    key *= 0xc2b2ae35;
    key ^= key >>> 16;
    return key;
}