// Exercita, no Supabase REAL, o envio de fotos da etapa 3c (bucket público "fotos") e limpa tudo no fim.
// Uso: node tests/backend/integracao-etapa3c.mjs   (precisa do .env e do bucket: npm run criar-bucket-fotos)
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ta, fim } from './executor.mjs';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';
import { criarArmazenamentoSupabase } from '../../backend/armazenamento-supabase.js';
import { criarHandler } from '../../backend/handler.js';

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
require('dotenv').config({ path: path.join(raiz, '.env'), quiet: true });
const { createClient } = require('@supabase/supabase-js');

const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SENHA = process.env.ADMIN_PASSWORD;
const h = criarHandler({
  repo: criarRepoSupabase(cliente),
  config: { adminPassword: SENHA },
  armazenamento: criarArmazenamentoSupabase({ cliente, urlBase: process.env.SUPABASE_URL })
});
const enviar = (corpo) => h.post({ action: 'uploadPhoto', senha: SENHA, mimeType: 'image/jpeg', ...corpo });

// JPEG mínimo de 1x1 pixel
const JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const JPEG_BYTES = Buffer.from(JPEG_B64, 'base64');
const criados = []; // caminhos que ESTE teste criou, para a limpeza final

await ta('envia um JPEG e a URL pública devolve 200, image/jpeg e os mesmos bytes', async () => {
  const r = await enviar({ base64: JPEG_B64 });
  assert.ok(r.url && r.fileId, JSON.stringify(r));
  criados.push(r.fileId);
  assert.ok(r.url.endsWith('?id=' + r.fileId));
  const resp = await fetch(r.url);
  assert.equal(resp.status, 200);
  assert.match(resp.headers.get('content-type'), /image\/jpeg/);
  assert.deepEqual(Buffer.from(await resp.arrayBuffer()), JPEG_BYTES);
});

await ta('segundo envio com fileIdAntigo apaga o primeiro (404) e o novo responde 200', async () => {
  const primeiro = criados[0];
  assert.ok(primeiro, 'depende do teste anterior');
  const urlPrimeiro = process.env.SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/fotos/' + primeiro;
  const r = await enviar({ base64: JPEG_B64, fileIdAntigo: primeiro });
  assert.ok(r.fileId, JSON.stringify(r));
  criados.push(r.fileId);
  assert.equal((await fetch(urlPrimeiro)).status, 404);
  assert.equal((await fetch(r.url)).status, 200);
});

await ta('recusa 400 KB e PNG, sem gravar nada', async () => {
  const grande = Buffer.alloc(400 * 1024, 1); grande[0] = 0xff; grande[1] = 0xd8; grande[2] = 0xff;
  assert.equal((await enviar({ base64: grande.toString('base64') })).error, 'Foto grande demais (máximo 300 KB).');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal((await enviar({ base64: png.toString('base64') })).error, 'A foto precisa ser uma imagem JPEG.');
});

// limpeza: remove tudo que este teste enviou (o primeiro já foi apagado pelo próprio teste; remover de novo é inofensivo)
const { error } = await cliente.storage.from('fotos').remove(criados);
console.log(error ? 'Limpeza falhou: ' + error.message : 'Limpeza: ' + criados.length + ' arquivo(s) de teste removido(s).');
fim();
