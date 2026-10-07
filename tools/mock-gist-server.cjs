// Servidor de pruebas que imita la API de Gists de GitHub (solo lo que usa la app).
// Uso: node tools/mock-gist-server.cjs 8090   y en la app: local.sync.api = 'http://localhost:8090'
const http = require('http');
const gists = new Map();
let n = 0;
const port = +process.argv[2] || 8090;
http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  if (req.headers.authorization !== 'Bearer ghp_prueba_valida_1234567890') return res.writeHead(401, cors).end('{"message":"Bad credentials"}');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const m = req.url.match(/^\/gists(?:\/(\w+))?$/);
    if (!m) return res.writeHead(404, cors).end('{}');
    const send = (g) => res.writeHead(200, cors).end(JSON.stringify(g));
    if (req.method === 'POST') {
      const id = 'g' + ++n;
      const g = { id, updated_at: new Date().toISOString() + n, files: {} };
      for (const [k, f] of Object.entries(JSON.parse(body).files)) g.files[k] = { content: f.content, truncated: false };
      gists.set(id, g);
      return send(g);
    }
    const g = gists.get(m[1]);
    if (!g) return res.writeHead(404, cors).end('{}');
    if (req.method === 'PATCH') {
      for (const [k, f] of Object.entries(JSON.parse(body).files)) g.files[k] = { content: f.content, truncated: false };
      g.updated_at = new Date().toISOString() + ++n;
      g.revisions = (g.revisions || 0) + 1;
    }
    send(g);
  });
}).listen(port, () => console.log('Gist falso en http://localhost:' + port));
