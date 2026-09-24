// Copia as fotos dos jogadores do Google Drive para o bucket "fotos" do Supabase e atualiza jogadores.foto.
// Uso: npm run migrar-fotos                 (SIMULAÇÃO: só lista o que faria; não baixa nem grava nada)
//      npm run migrar-fotos -- --aplicar    (baixa, envia e atualiza de verdade)
// Idempotente: jogador cuja foto já aponta para o nosso Storage é pulado. Um erro num jogador não para os outros.
// As fotos são copiadas SEM reprocessar (o app já as reduziu no envio); as que não forem JPEG ou passarem de 300 KB
// são puladas e reportadas. Os originais continuam no Drive.
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const LIMITE_BYTES = 300 * 1024;
const DRIVE = /(drive\.google\.com|googleusercontent\.com|usercontent\.google\.com)/;
const NOSSO_STORAGE = '/storage/v1/object/public/fotos/';
const aplicar = process.argv.includes('--aplicar');

const ehJpeg = (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

// mesmo padrão do backend: ^[0-9a-z-]+\.jpg$ (id do jogador em minúsculas, o que não for [0-9a-z] vira "-")
function novoCaminho(jogadorId) {
  const id = String(jogadorId).toLowerCase().replace(/[^0-9a-z]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const aleatorio = Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) => n.toString(16).padStart(2, '0')).join('');
  return (id ? id + '-' : '') + Date.now() + '-' + aleatorio + '.jpg';
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env');
    process.exit(1);
  }
  const urlBase = process.env.SUPABASE_URL.replace(/\/+$/, '');
  const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: jogadores, error } = await cliente.from('jogadores').select('id, nome, foto');
  if (error) throw new Error('Não consegui ler jogadores: ' + error.message);

  console.log(aplicar ? 'MODO APLICAR: vai copiar e atualizar.' : 'SIMULAÇÃO (nada será baixado nem gravado). Use --aplicar para valer.');
  const r = { migrados: 0, jaNoStorage: 0, semFoto: 0, pulados: [], falhas: [] };

  for (const j of jogadores) {
    const foto = String(j.foto || '');
    if (!foto) { r.semFoto++; continue; }
    if (foto.includes(NOSSO_STORAGE)) { r.jaNoStorage++; continue; }
    const m = /[?&]id=([^&]+)/.exec(foto);
    if (!m || !DRIVE.test(foto)) { r.pulados.push(`${j.id}: foto que não é do Drive nem do nosso Storage`); continue; }
    if (!aplicar) { console.log(`  [simulação] ${j.id} (${j.nome}): copiaria o arquivo do Drive ${m[1].slice(0, 6)}...`); r.migrados++; continue; }

    try {
      const resp = await fetch('https://drive.google.com/uc?export=download&id=' + encodeURIComponent(m[1]), { redirect: 'follow' });
      if (!resp.ok) throw new Error('download falhou (HTTP ' + resp.status + ')');
      const bytes = new Uint8Array(await resp.arrayBuffer());
      if (!ehJpeg(bytes)) { r.pulados.push(`${j.id}: o arquivo baixado não é JPEG (Drive pode ter devolvido uma página)`); continue; }
      if (bytes.length > LIMITE_BYTES) { r.pulados.push(`${j.id}: arquivo com ${Math.round(bytes.length / 1024)} KB (máximo 300 KB)`); continue; }

      const caminho = novoCaminho(j.id);
      const { error: erroUp } = await cliente.storage.from('fotos').upload(caminho, bytes, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
      if (erroUp) throw new Error('envio ao bucket falhou: ' + erroUp.message);
      const novaUrl = urlBase + NOSSO_STORAGE + caminho + '?id=' + caminho;
      const { error: erroUpd } = await cliente.from('jogadores').update({ foto: novaUrl }).eq('id', j.id);
      if (erroUpd) {
        await cliente.storage.from('fotos').remove([caminho]); // não deixa arquivo órfão no bucket
        throw new Error('atualizar jogadores.foto falhou: ' + erroUpd.message);
      }
      console.log(`  ${j.id} (${j.nome}): migrada (${Math.round(bytes.length / 1024)} KB)`);
      r.migrados++;
    } catch (e) {
      r.falhas.push(`${j.id}: ${e.message}`);
    }
  }

  console.log(`\nResumo: ${r.migrados} ${aplicar ? 'migrada(s)' : 'a migrar'}, ${r.jaNoStorage} já no Storage, ${r.semFoto} sem foto, ${r.pulados.length} pulada(s), ${r.falhas.length} falha(s).`);
  r.pulados.forEach((p) => console.log('  pulada  - ' + p));
  r.falhas.forEach((f) => console.log('  FALHA   - ' + f));
  if (r.falhas.length) process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
