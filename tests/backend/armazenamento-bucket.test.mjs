import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarArmazenamentoSupabase } from '../../backend/armazenamento-supabase.js';

function clienteFalso(erro = null) {
  const chamadas = [];
  return {
    chamadas,
    storage: {
      from: (bucket) => ({
        upload: async (caminho, bytes, opcoes) => { chamadas.push({ op: 'upload', bucket, caminho, opcoes }); return { error: erro }; },
        remove: async (caminhos) => { chamadas.push({ op: 'remove', bucket, caminhos }); return { error: erro }; }
      })
    }
  };
}

await ta('sem "bucket" o padrão continua "fotos" (o Terça não muda)', async () => {
  const c = clienteFalso();
  const a = criarArmazenamentoSupabase({ cliente: c, urlBase: 'https://x.supabase.co/' });
  const url = await a.enviar('jog-1.jpg', new Uint8Array([1]), 'image/jpeg');
  assert.equal(c.chamadas[0].bucket, 'fotos');
  assert.equal(url, 'https://x.supabase.co/storage/v1/object/public/fotos/jog-1.jpg?id=jog-1.jpg');
});

await ta('com bucket "fotos-meme": envia, apaga e monta a URL nesse bucket, nunca no do Terça', async () => {
  const c = clienteFalso();
  const a = criarArmazenamentoSupabase({ cliente: c, urlBase: 'https://x.supabase.co', bucket: 'fotos-meme' });
  const url = await a.enviar('jog-2.jpg', new Uint8Array([1]), 'image/jpeg');
  await a.apagar('jog-2.jpg');
  assert.deepEqual(c.chamadas.map((x) => x.bucket), ['fotos-meme', 'fotos-meme']);
  assert.equal(url, 'https://x.supabase.co/storage/v1/object/public/fotos-meme/jog-2.jpg?id=jog-2.jpg');
  assert.ok(!url.includes('/public/fotos/'));
});

await ta('erro do Storage cita o bucket usado', async () => {
  const a = criarArmazenamentoSupabase({ cliente: clienteFalso({ message: 'sem espaço' }), urlBase: 'https://x.supabase.co', bucket: 'fotos-meme' });
  await assert.rejects(() => a.enviar('a.jpg', new Uint8Array([1]), 'image/jpeg'), /bucket fotos-meme.*sem espaço/);
  await assert.rejects(() => a.apagar('a.jpg'), /bucket fotos-meme/);
});

fim();
