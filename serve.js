/* Tiny zero-dependency static server for local development.
   Usage: node serve.js [port]   (defaults to 5173)
   The game is a static site — in production just host the files in ./public. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, 'public');
const port = Number(process.argv[2] || 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.resolve(root, '.' + urlPath);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log(`Big Two running at http://localhost:${port}`));
