// Armazenamento de fotos no Supabase Storage (bucket público; um por grupo, padrão "fotos"). O cliente (supabase-js) vem por injeção.
export function criarArmazenamentoSupabase({ cliente, urlBase, bucket = 'fotos' }) {
  const base = String(urlBase || '').replace(/\/+$/, '');
  return {
    async enviar(caminho, bytes, contentType) {
      // cache de 1 ano é seguro porque cada envio tem nome único; upsert:false impede sobrescrever uma foto existente
      const { error } = await cliente.storage.from(bucket).upload(caminho, bytes, { contentType, cacheControl: '31536000', upsert: false });
      if (error) throw new Error('Storage (bucket ' + bucket + '): ' + error.message);
      // o Storage ignora a query string; "?id=" existe só para o front (extrairFileIdDaFoto) devolver o caminho depois
      return base + '/storage/v1/object/public/' + bucket + '/' + caminho + '?id=' + caminho;
    },
    async apagar(caminho) {
      const { error } = await cliente.storage.from(bucket).remove([caminho]);
      if (error) throw new Error('Storage (bucket ' + bucket + '): ' + error.message);
    }
  };
}
