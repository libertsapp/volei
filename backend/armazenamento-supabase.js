// Armazenamento de fotos no Supabase Storage (bucket público "fotos"). O cliente (supabase-js) vem por injeção.
const BUCKET = 'fotos';

export function criarArmazenamentoSupabase({ cliente, urlBase }) {
  const base = String(urlBase || '').replace(/\/+$/, '');
  return {
    async enviar(caminho, bytes, contentType) {
      // cache de 1 ano é seguro porque cada envio tem nome único; upsert:false impede sobrescrever uma foto existente
      const { error } = await cliente.storage.from(BUCKET).upload(caminho, bytes, { contentType, cacheControl: '31536000', upsert: false });
      if (error) throw new Error('Storage (bucket ' + BUCKET + '): ' + error.message);
      // o Storage ignora a query string; "?id=" existe só para o front (extrairFileIdDaFoto) devolver o caminho depois
      return base + '/storage/v1/object/public/' + BUCKET + '/' + caminho + '?id=' + caminho;
    },
    async apagar(caminho) {
      const { error } = await cliente.storage.from(BUCKET).remove([caminho]);
      if (error) throw new Error('Storage (bucket ' + BUCKET + '): ' + error.message);
    }
  };
}
