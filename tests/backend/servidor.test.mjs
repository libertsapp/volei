import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ta, fim } from './executor.mjs';
import { criarServidor } from '../../backend/servidor.js';

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'servidor-teste-'));
const arquivoHtml = path.join(pasta, 'app.html');
fs.writeFileSync(arquivoHtml, '<html><body><script>const SHEET_API_URL = "https://script.google.com/producao";</script></body></html>');

let chamadasPost = 0;
const handler = { async get() { return { ok: 'get' }; }, async post(b) { chamadasPost++; return { eco: b }; } };
const servidor = criarServidor({ handler, arquivoHtml });
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const porta = servidor.address().port;
const ORIGEM = `http://localhost:${porta}`;

function pedir({ metodo = 'GET', caminho = '/', headers = {}, corpo }) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers }, (res) => {
      let texto = '';
      res.on('data', (d) => (texto += d));
      res.on('end', () => resolve({ status: res.statusCode, texto }));
    });
    req.on('error', () => resolve({ status: 0, texto: '' })); // conexão cortada pelo servidor
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
}

await ta('GET /api devolve o handler.get', async () => {
  const r = await pedir({ caminho: '/api' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.texto), { ok: 'get' });
});

await ta('POST /api sem Origin é recusado (403) e o handler não é chamado', async () => {
  const antes = chamadasPost;
  const r = await pedir({ metodo: 'POST', caminho: '/api', corpo: '{"action":"x"}' });
  assert.equal(r.status, 403);
  assert.equal(chamadasPost, antes);
});

await ta('POST /api com Origin de outro site é recusado (403)', async () => {
  const antes = chamadasPost;
  const r = await pedir({ metodo: 'POST', caminho: '/api', headers: { Origin: 'http://evil.example' }, corpo: '{"action":"x"}' });
  assert.equal(r.status, 403);
  assert.equal(chamadasPost, antes);
});

await ta('POST /api com a Origin da própria página funciona', async () => {
  const r = await pedir({ metodo: 'POST', caminho: '/api', headers: { Origin: ORIGEM }, corpo: '{"action":"ping"}' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.texto), { eco: { action: 'ping' } });
});

await ta('Host diferente de localhost/127.0.0.1 é recusado (403)', async () => {
  const r = await pedir({ caminho: '/api', headers: { Host: 'evil.example' } });
  assert.equal(r.status, 403);
});

await ta('corpo maior que 1 MB é recusado e o handler não é chamado', async () => {
  const antes = chamadasPost;
  const r = await pedir({ metodo: 'POST', caminho: '/api', headers: { Origin: ORIGEM }, corpo: 'x'.repeat(2 * 1024 * 1024) });
  assert.ok(r.status === 413 || r.status === 0, 'esperava 413 ou conexão cortada, veio ' + r.status);
  assert.equal(chamadasPost, antes);
});

await ta('JSON inválido vira { error } (200), sem derrubar o servidor', async () => {
  const r = await pedir({ metodo: 'POST', caminho: '/api', headers: { Origin: ORIGEM }, corpo: '{nao e json' });
  assert.equal(r.status, 200);
  assert.ok(JSON.parse(r.texto).error);
});

await ta('GET / serve a página com a URL da API trocada e sem apontar para a produção', async () => {
  const r = await pedir({ caminho: '/' });
  assert.equal(r.status, 200);
  assert.ok(r.texto.includes(`const SHEET_API_URL = "http://localhost:${porta}/api";`));
  assert.equal(r.texto.includes('script.google.com'), false);
  assert.ok(r.texto.includes('perfil'), 'a injeção do ?perfil=admin deve estar na página');
});

await ta('outros caminhos: 404; método errado em /api: 405', async () => {
  assert.equal((await pedir({ caminho: '/sw.js' })).status, 404);
  assert.equal((await pedir({ caminho: '/api/x' })).status, 404);
  assert.equal((await pedir({ metodo: 'PUT', caminho: '/api', headers: { Origin: ORIGEM } })).status, 405);
});

await ta('HTML sem a linha SHEET_API_URL: o servidor recusa nascer', async () => {
  const ruim = path.join(pasta, 'ruim.html');
  fs.writeFileSync(ruim, '<html><body>sem a linha</body></html>');
  assert.throws(() => criarServidor({ handler, arquivoHtml: ruim }), /SHEET_API_URL/);
});

servidor.close();
fs.rmSync(pasta, { recursive: true, force: true });
fim();
