public byte[] deriveKey(String pass) {
    byte[] key = new byte[16];
    for(int i=0; i<pass.length(); i++) {
        key[i%16] ^= (byte)(pass.charAt(i) << 1);
    }
    return key;
}