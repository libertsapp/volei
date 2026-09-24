// Armazenamento de fotos em memória (mesma interface do armazenamento-supabase), usado nos testes.
export function criarArmazenamentoMemoria() {
  const arquivos = new Map(); // caminho -> { bytes, contentType }
  const chamadas = { enviar: [], apagar: [] };
  return {
    arquivos, chamadas,
    async enviar(caminho, bytes, contentType) {
      chamadas.enviar.push(caminho);
      arquivos.set(caminho, { bytes, contentType });
      return 'https://exemplo.test/fotos/' + caminho + '?id=' + caminho;
    },
    async apagar(caminho) {
      chamadas.apagar.push(caminho);
      arquivos.delete(caminho);
    }
  };
}
