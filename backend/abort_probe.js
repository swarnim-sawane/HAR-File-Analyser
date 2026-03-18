const fs = require('fs');
const payload = fs.readFileSync(process.argv[2], 'utf8');
const url = process.argv[3];
const ac = new AbortController();
setTimeout(() => ac.abort(), 2000);
fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: payload,
  signal: ac.signal,
}).catch(() => {}).finally(() => setTimeout(() => process.exit(0), 500));