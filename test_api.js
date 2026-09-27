const http = require('http');

const data = JSON.stringify({
  github_url: 'https://github.com/Dev8-Siddharth/IP-SAKTI-Sahayak_v4',
});

const req = http.request(
  {
    hostname: 'localhost',
    port: 4000,
    path: '/scan/static',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
    },
  },
  (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      console.log('STATUS:', res.statusCode);
      console.log('BODY:', body);
    });
  }
);

req.on('error', (e) => {
  console.error('ERROR:', e.message);
});

req.write(data);
req.end();
