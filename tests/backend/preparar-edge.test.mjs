import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ta, fim } from './executor.mjs';

const { planejarCopia, deveCopiar } = createRequire(import.meta.url)('../../scripts/preparar-edge.js');

await ta('decide o que copiar: .js do backend, exceto servidor*.js e não-.js', () => {
  assert.equal(deveCopiar('handler.js'), true);
  assert.equal(deveCopiar('edge.js'), true);
  assert.equal(deveCopiar('servidor.js'), false);
  assert.equal(deveCopiar('servidor-local.js'), false);
  assert.equal(deveCopiar('package.json'), false);
});

await ta('rejeita arquivo copiável com node:, process., require( ou Buffer', () => {
  for (const codigo of ["import fs from 'node:fs';", 'const x = process.env.A;', "const y = require('a');", 'Buffer.from(x)']) {
    const r = planejarCopia([{ nome: 'ruim.js', conteudo: 'const ok = 1;\n' + codigo }]);
    assert.equal(r.problemas.length, 1, codigo);
    assert.match(r.problemas[0], /^ruim\.js:2:/);
  }
});

await ta('aceita código puro, comentários que citam os termos e ignora servidor*.js mesmo impuro', () => {
  const r = planejarCopia([
    { nome: 'ok.js', conteudo: '// sem node:*, process., require( nem Buffer\nexport const a = 1;\r\n' },
    { nome: 'servidor.js', conteudo: "import http from 'node:http'; Buffer.concat([])" },
    { nome: 'package.json', conteudo: '{}' }
  ]);
  assert.deepEqual(r.problemas, []);
  assert.deepEqual(r.copiar, ['ok.js']);
  assert.deepEqual(r.ignorados, ['servidor.js', 'package.json']);
});

await ta('o backend REAL de hoje passa na checagem de pureza', () => {
  const dir = path.join(import.meta.dirname, '../../backend');
  const arquivos = fs.readdirSync(dir).map((nome) => ({ nome, conteudo: fs.readFileSync(path.join(dir, nome), 'utf8') }));
  const r = planejarCopia(arquivos);
  assert.deepEqual(r.problemas, []);
  assert.ok(r.copiar.includes('edge.js') && r.copiar.includes('limitador.js') && !r.copiar.includes('servidor.js'));
});

fim();
