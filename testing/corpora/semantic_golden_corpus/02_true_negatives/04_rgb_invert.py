def invert_colors(pixels):
    for i in range(len(pixels)):
        pixels[i] = pixels[i] ^ 0xFFFFFF # Invert bits for color swap
    return pixels