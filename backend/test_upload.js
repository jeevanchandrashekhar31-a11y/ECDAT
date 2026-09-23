const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const FormData = require('form-data');
const http = require('http');

async function test() {
  const zip = new JSZip();
  zip.file('test.java', 'import javax.crypto.Cipher; Cipher c = Cipher.getInstance("DES/ECB/PKCS5Padding");');
  const buf = await zip.generateAsync({type: 'nodebuffer'});
  
  const form = new FormData();
  form.append('file', buf, { filename: 'test.zip' });
  
  const req = http.request('http://localhost:5000/scan/static', {
    method: 'POST',
    headers: form.getHeaders(),
  }, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => console.log('HTTP', res.statusCode, data));
  });
  form.pipe(req);
}
test();
