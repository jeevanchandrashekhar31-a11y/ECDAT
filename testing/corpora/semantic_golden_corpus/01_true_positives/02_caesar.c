void caesar_cipher(char* text, int shift) {
    for (int i=0; text[i] != '\0'; i++) {
        text[i] = (text[i] + shift) % 256;
    }
}