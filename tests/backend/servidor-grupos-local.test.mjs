import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ta, fim } from './executor.mjs';
import { criarServidorGrupos } from '../../scripts/servidor-grupos-local.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grupos-'));
const html = path.join(dir, 'app.html');
fs.writeFileSync(html, '<script>\nconst SHEET_API_URL = "https://x/terca";\nconst GRUPOS_API_URL = "https://x/grupos-api";\nconst HOSTS_MODO_GRUPO = ["volei.memberstars.com"];\n</script>');
const sw = path.join(dir, 'sw.js');
fs.writeFileSync(sw, '// sw');

const servidor = criarServidorGrupos({ arquivoHtml: html, arquivoSw: sw });
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + servidor.address().port;
const post = (corpo, consulta = '') => fetch(base + '/api' + consulta, { method: 'POST', headers: { origin: base, 'content-type': 'text/plain' }, body: JSON.stringify(corpo) }).then((r) => r.json());

await ta('qualquer caminho serve o app com a API local e localhost no modo grupo', async () => {
  for (const caminho of ['/', '/criar', '/quinta/', '/quinta/qualquer']) {
    const t = await (await fetch(base + caminho)).text();
    assert.match(t, /const GRUPOS_API_URL = "\/api";/, caminho);
    assert.match(t, /const HOSTS_MODO_GRUPO = \["volei\.memberstars\.com", "localhost", "127\.0\.0\.1"\];/, caminho);
    assert.match(t, /const SHEET_API_URL = "https:\/\/x\/terca";/, caminho); // o do Terça não é tocado
  }
  assert.equal(await (await fetch(base + '/quinta/sw.js')).text(), '// sw');
});

await ta('criar grupo com login de teste e usar pela query ?g=', async () => {
  const r = await post({ action: 'criarGrupo', idToken: 'dev:dono@teste.com', grupoNovo: { nome: 'Vôlei de Quinta', apelido: 'quinta', cidade: 'BH', uf: 'MG', cor: '#ffd700' } });
  assert.deepEqual(r, { status: 'ok', apelido: 'quinta' });
  const login = await post({ action: 'loginGoogle', idToken: 'dev:dono@teste.com' }, '?g=quinta');
  assert.equal(login.perfil, 'admin');
  const g = await (await fetch(base + '/api?g=quinta')).json();
  assert.equal(g.grupo.nome, 'Vôlei de Quinta');
});

await ta('POST de outra origem é recusado', async () => {
  const r = await fetch(base + '/api', { method: 'POST', headers: { origin: 'https://malicioso.com' }, body: '{}' });
  assert.equal(r.status, 403);
});

servidor.close();
fim();
