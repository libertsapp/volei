import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { dbParaAbas } from './dbParaAbas.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const caminhoGs = path.join(raiz, 'apps-script-codigo.gs');

if (!fs.existsSync(caminhoGs)) {
  console.log('PULADO - apps-script-codigo.gs não existe nesta pasta (o arquivo é ignorado pelo git; copie-o da máquina do usuário).');
  process.exit(0);
}

const { criarAmbiente } = require('../helpers/planilha-falsa.js');

await ta('paridade do GET: o backend novo devolve o mesmo JSON que o doGet do .gs real', async () => {
  const esperado = criarAmbiente(dbParaAbas(fixture), [caminhoGs]).get();
  const obtido = JSON.parse(JSON.stringify(await criarHandler({ repo: criarRepoMemoria(fixture) }).get()));
  assert.deepEqual(obtido, esperado);
});

fim();
