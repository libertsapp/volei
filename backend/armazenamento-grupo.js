// Fotos dos grupos independentes: um bucket só ("fotos-grupos"), uma pasta por grupo (<grupo_id>/arquivo.jpg).
// Embrulha o armazenamento de sempre: envia dentro da pasta do grupo e devolve a URL com "?id=" SEM o prefixo — o
// fotos.js e o front só conhecem nomes sem barra. Apagar só aceita nome sem barra e sempre dentro da própria pasta,
// então um grupo nunca apaga a foto de outro.
export function armazenamentoDoGrupo(base, grupoId) {
  if (!grupoId) throw new Error('armazenamentoDoGrupo: grupoId obrigatório');
  const prefixo = grupoId + '/';
  return {
    async enviar(caminho, bytes, tipo) {
      const url = await base.enviar(prefixo + caminho, bytes, tipo);
      return String(url).replace('?id=' + prefixo, '?id=');
    },
    async apagar(caminho) {
      const c = String(caminho || '');
      if (!c || c.includes('/') || c.includes('..')) throw new Error('armazenamentoDoGrupo: caminho inválido');
      return base.apagar(prefixo + c);
    }
  };
}
