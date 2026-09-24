function rle_compress(str) {
    let out = '';
    let count = 1;
    for(let i=1; i<=str.length; i++) {
        if(str[i] === str[i-1]) count++;
        else { out += str[i-1] + count; count = 1; }
    }
    return out;
}