function vigenere(text, key) {
    let out = '';
    for(let i=0; i<text.length; i++) {
        let k = key.charCodeAt(i % key.length);
        out += String.fromCharCode(text.charCodeAt(i) ^ k);
    }
    return out;
}