// Ids de convidado têm a forma "convidado:NOME#xxxx"; o nome vem do próprio id (mesma regra da migração).
export function nomeDoConvidado(id) {
  const texto = String(id ?? '');
  if (!texto.startsWith('convidado:')) return null;
  return texto.slice('convidado:'.length).replace(/#[^#]*$/, '').trim();
}

// Recebe uma lista de ids (com repetidos, vazios e ids normais) e devolve os convidados: [{ id, nome }], sem repetir.
export function coletarConvidados(ids) {
  const vistos = new Set();
  const saida = [];
  for (const id of ids) {
    const nome = nomeDoConvidado(id);
    if (nome === null || vistos.has(id)) continue;
    vistos.add(id);
    saida.push({ id: String(id), nome });
  }
  return saida;
}
