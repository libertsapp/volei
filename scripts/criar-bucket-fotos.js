// Cria (ou ajusta) o bucket público "fotos" do Supabase Storage. Idempotente: pode rodar quantas vezes quiser.
// Uso: npm run criar-bucket-fotos      (precisa do .env com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY)
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

// mesmos limites que o backend impõe no envio (300 KB, só JPEG): defesa em dobro para um bucket público
const OPCOES = { public: true, fileSizeLimit: 300 * 1024, allowedMimeTypes: ['image/jpeg'] };

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env');
    process.exit(1);
  }
  const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: existentes, error: erroLista } = await cliente.storage.listBuckets();
  if (erroLista) throw new Error('Não consegui listar os buckets: ' + erroLista.message);

  if (existentes.some((b) => b.name === 'fotos')) {
    const { error } = await cliente.storage.updateBucket('fotos', OPCOES);
    if (error) throw new Error('Não consegui atualizar o bucket fotos: ' + error.message);
    console.log('Bucket "fotos" já existia: ajustado para público, máximo 300 KB, somente image/jpeg.');
  } else {
    const { error } = await cliente.storage.createBucket('fotos', OPCOES);
    if (error) throw new Error('Não consegui criar o bucket fotos: ' + error.message);
    console.log('Bucket "fotos" criado: público, máximo 300 KB, somente image/jpeg.');
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
