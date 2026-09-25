import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarEdge, ipDoCliente } from '../../backend/edge.js';

const GH = 'https://libertsapp.github.io';
const LOCAL = 'http://localhost:8000';
const chamadas = { post: [], get: 0 };
const handler = {
  async get() { chamadas.get++; return { players: [] }; },
  async post(b, ctx) { chamadas.post.push([b, ctx]); if (b.explodir) throw new Error('SEGREDO-INTERNO stack'); return { eco: b }; }
};
const edge = criarEdge({ handler, origensPermitidas: [GH, LOCAL], limiteCorpoBytes: 1000 });
const req = (metodo, { url = 'https://x.supabase.co/functions/v1/terca-api-teste', headers = {}, corpo } = {}) => new Request(url, { method: metodo, headers, body: corpo });
const json = async (r) => JSON.parse(await r.text());

await ta('OPTIONS de origem permitida: 204 com CORS completo', async () => {
  const r = await edge(req('OPTIONS', { headers: { origin: GH } }));
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), GH);
  assert.equal(r.headers.get('vary'), 'Origin');
  assert.equal(r.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS');
  assert.equal(r.headers.get('access-control-allow-headers'), 'Content-Type');
  assert.equal(r.headers.get('access-control-max-age'), '86400');
});

await ta('OPTIONS de origem desconhecida ou sem origem: 204 sem nenhum cabeçalho CORS', async () => {
  for (const headers of [{ origin: 'https://malvado.com' }, {}]) {
    const r = await edge(req('OPTIONS', { headers }));
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(r.headers.get('access-control-allow-methods'), null);
  }
});

await ta('GET: JSON, no-store, ACAO só para origem permitida, e público (sem Origin funciona)', async () => {
  let r = await edge(req('GET', { headers: { origin: GH } }));
  assert.equal(r.status, 200);
  assert.deepEqual(await json(r), { players: [] });
  assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('access-control-allow-origin'), GH);
  r = await edge(req('GET', { headers: { origin: 'https://malvado.com' } }));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  r = await edge(req('GET'));
  assert.equal(r.status, 200);
});

await ta('POST sem Origin ou com Origin não permitida: 403 e o handler não é chamado', async () => {
  const antes = chamadas.post.length;
  for (const headers of [{}, { origin: 'https://malvado.com' }, { origin: GH + '.malvado.com' }, { origin: 'null' }]) {
    const r = await edge(req('POST', { headers, corpo: '{"action":"ping"}' }));
    assert.equal(r.status, 403);
    assert.deepEqual(await json(r), { error: 'Origem não permitida.' });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  }
  assert.equal(chamadas.post.length, antes);
});

await ta('POST de origem permitida com text/plain: corpo vira objeto, resposta com CORS, no-store e IP no contexto', async () => {
  const r = await edge(req('POST', { headers: { origin: LOCAL, 'content-type': 'text/plain;charset=UTF-8', 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }, corpo: '{"action":"ping","n":"ção"}' }));
  assert.equal(r.status, 200);
  assert.deepEqual(await json(r), { eco: { action: 'ping', n: 'ção' } });
  assert.equal(r.headers.get('access-control-allow-origin'), LOCAL);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(chamadas.post.at(-1)[1], { ip: '1.2.3.4' });
});

await ta('413 pelo Content-Length declarado, sem chamar o handler', async () => {
  const antes = chamadas.post.length;
  const r = await edge(req('POST', { headers: { origin: GH, 'content-length': '5000' }, corpo: '{}' }));
  assert.equal(r.status, 413);
  assert.equal(chamadas.post.length, antes);
});

await ta('413 pelo tamanho lido do stream, sem Content-Length (e sem ler além do limite)', async () => {
  let lidos = 0;
  const stream = new ReadableStream({
    pull(c) { lidos++; c.enqueue(new TextEncoder().encode('a'.repeat(400))); if (lidos > 50) c.close(); }
  });
  const r = await edge(new Request('https://x/', { method: 'POST', headers: { origin: GH }, body: stream, duplex: 'half' }));
  assert.equal(r.status, 413);
  assert.ok(lidos < 10, 'parou de ler cedo: ' + lidos);
  // exatamente no limite passa
  const ok = await edge(req('POST', { headers: { origin: GH }, corpo: JSON.stringify({ a: 'x'.repeat(1000 - 8) }) }));
  assert.equal(ok.status, 200);
});

await ta('JSON inválido, string, número, array e null: 400 "Corpo inválido."; corpo vazio vira {}', async () => {
  for (const corpo of ['{oi', '[1]', 'null', '"texto"', '42']) {
    const r = await edge(req('POST', { headers: { origin: GH }, corpo }));
    assert.equal(r.status, 400, corpo);
    assert.deepEqual(await json(r), { error: 'Corpo inválido.' });
  }
  const r = await edge(req('POST', { headers: { origin: GH }, corpo: '' }));
  assert.deepEqual(await json(r), { eco: {} });
});

await ta('exceção do handler (get e post): 500 genérico, sem vazar mensagem nem stack, com no-store e CORS', async () => {
  const registrados = [];
  const e = criarEdge({ handler, origensPermitidas: [GH], registrar: (x) => registrados.push(x.message) });
  let r = await e(req('POST', { headers: { origin: GH, 'cf-connecting-ip': '1.1.1.1' }, corpo: '{"explodir":1}' }));
  assert.equal(r.status, 500);
  const texto = await r.text();
  assert.equal(texto, JSON.stringify({ error: 'Erro interno no servidor.' }));
  assert.ok(!/SEGREDO|stack/.test(texto));
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('access-control-allow-origin'), GH);
  assert.equal(registrados.length, 1);
  const e2 = criarEdge({ handler: { get: async () => { throw new Error('SEGREDO'); }, post: async () => ({}) }, origensPermitidas: [GH] });
  r = await e2(req('GET'));
  assert.equal(r.status, 500);
  assert.ok(!(await r.text()).includes('SEGREDO'));
});

await ta('o caminho é ignorado (/, /terca-api, qualquer coisa); outros métodos: 405', async () => {
  for (const url of ['https://x/', 'https://x/terca-api', 'https://x/functions/v1/terca-api-teste/a/b?perfil=admin']) {
    assert.equal((await edge(req('GET', { url }))).status, 200);
    assert.equal((await edge(req('POST', { url, headers: { origin: GH }, corpo: '{}' }))).status, 200);
  }
  const r = await edge(req('DELETE', { headers: { origin: GH } }));
  assert.equal(r.status, 405);
});

await ta('sem origens configuradas, nenhum POST passa; barra final na lista é tolerada', async () => {
  const vazio = criarEdge({ handler, origensPermitidas: [] });
  assert.equal((await vazio(req('POST', { headers: { origin: GH }, corpo: '{}' }))).status, 403);
  const barra = criarEdge({ handler, origensPermitidas: [GH + '/'] });
  assert.equal((await barra(req('POST', { headers: { origin: GH }, corpo: '{}' }))).status, 200);
});

await ta('ipDoCliente usa SÓ cf-connecting-ip; x-forwarded-for é ignorado (o cliente poderia forjá-lo)', async () => {
  assert.equal(ipDoCliente(new Headers({ 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' })), '9.9.9.9');
  assert.equal(ipDoCliente(new Headers({ 'x-forwarded-for': ' 1.1.1.1 , 2.2.2.2' })), '');
  assert.equal(ipDoCliente(new Headers()), '');
});

await ta('sem cf-connecting-ip: balde "desconhecido" e um aviso só por instância (registrar)', async () => {
  const ctxs = [];
  const avisos = [];
  const e = criarEdge({ handler: { get: async () => ({}), post: async (b, ctx) => { ctxs.push(ctx); return {}; } }, origensPermitidas: [GH], registrar: (x) => avisos.push(x.message) });
  for (let i = 0; i < 3; i++) await e(req('POST', { headers: { origin: GH, 'x-forwarded-for': '6.6.6.6' }, corpo: '{}' }));
  await e(req('POST', { headers: { origin: GH, 'cf-connecting-ip': '7.7.7.7' }, corpo: '{}' }));
  assert.deepEqual(ctxs.map((c) => c.ip), ['desconhecido', 'desconhecido', 'desconhecido', '7.7.7.7']);
  assert.deepEqual(avisos, ['cf-connecting-ip ausente: limitador usando balde único']);
});

fim();
