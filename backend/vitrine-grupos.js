// Vitrine pública dos grupos de vôlei: o que memberstars.com mostra em "Grupos em quadra" (spec do member_star,
// 2026-10-14). Só dado de GRUPO (nome, cidade, cor, logo); nunca dono, apelido, id ou jogadores.
// "Jogou no mês" = rodada de verdade (sem rascunho) ou check-in com data nos últimos 30 dias até hoje (dia de Brasília).
export const DIAS_NO_MES = 30;

// 'YYYY-MM-DD' de hoje em Brasília (en-CA já formata como ano-mês-dia)
export function hojeEmBrasilia(agora) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

// hoje em Brasília menos 30 dias
export function dataLimite(agora) {
  const d = new Date(hojeEmBrasilia(agora) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - DIAS_NO_MES);
  return d.toISOString().slice(0, 10);
}

// Junta grupos novos (grupos.grupos) e os dois antigos (liga.grupos: terca, meme) numa lista pública.
export function montarVitrine({ grupos = [], legados = [], jogaram = new Set() }) {
  const lista = [
    ...grupos.filter((g) => g.status === 'ativo').map((g) => ({
      chave: g.id, nome: g.nome, cidade: g.cidade || '', uf: g.uf || '', cor: g.cor_destaque || '',
      logoUrl: g.logo_url || '', desde: String(g.criado_em || '').slice(0, 10)
    })),
    ...legados.filter((g) => g.ativo !== false).map((g) => ({
      chave: g.id, nome: g.nome, cidade: g.cidade || '', uf: g.uf || '', cor: g.cor || '', logoUrl: g.logo_url || '', desde: ''
    }))
  ].map((g) => ({ ...g, jogouNoMes: jogaram.has(g.chave) }));
  // quem jogou primeiro; depois o mais novo (os antigos, sem data, vão para o fim de cada parte)
  lista.sort((a, b) => (Number(b.jogouNoMes) - Number(a.jogouNoMes)) || (b.desde > a.desde ? 1 : b.desde < a.desde ? -1 : 0));
  return {
    cadastrados: lista.length,
    jogaramNoMes: lista.filter((g) => g.jogouNoMes).length,
    grupos: lista.map(({ chave, ...publico }) => publico)
  };
}

/* Lê do Supabase. clienteGrupos aponta para o schema "grupos", clienteLiga para "liga" e clientesLegados para os
   schemas dos grupos antigos ({ terca: public, meme: meme }). Atividade: uma consulta com limit(1) por grupo e
   tabela, para nunca trazer todas as rodadas/check-ins do mês. */
export function criarLeitorVitrine({ clienteGrupos, clienteLiga, clientesLegados = {}, relogio = () => new Date() }) {
  const falha = (onde, error) => new Error('vitrine ' + onde + ': ' + error.message);

  // janela = { desde, ate }: até hoje, para check-in do jogo da semana que vem não contar como "jogou"
  async function teveJogo(cliente, janela, grupoId) {
    for (const [tabela, soRodadaReal] of [['rodadas', true], ['checkins', false]]) {
      let q = cliente.from(tabela).select('data').gte('data', janela.desde).lte('data', janela.ate);
      if (grupoId) q = q.eq('grupo_id', grupoId);
      if (soRodadaReal) q = q.eq('rascunho', false);
      const { data, error } = await q.limit(1);
      if (error) throw falha(tabela, error);
      if (data && data.length) return true;
    }
    return false;
  }

  return async function lerVitrine() {
    const agora = relogio();
    const janela = { desde: dataLimite(agora), ate: hojeEmBrasilia(agora) };
    const [rGrupos, rLiga] = await Promise.all([
      clienteGrupos.from('grupos').select('id,nome,cidade,uf,cor_destaque,logo_url,status,criado_em').eq('status', 'ativo'),
      clienteLiga.from('grupos').select('id,nome,cidade,uf,cor,logo_url,ativo').in('id', Object.keys(clientesLegados))
    ]);
    if (rGrupos.error) throw falha('grupos', rGrupos.error);
    if (rLiga.error) throw falha('liga', rLiga.error);
    const grupos = rGrupos.data || [];
    const legados = (rLiga.data || []).filter((g) => clientesLegados[g.id]);
    const achados = await Promise.all([
      ...grupos.map((g) => teveJogo(clienteGrupos, janela, g.id).then((sim) => (sim ? g.id : null))),
      ...legados.map((g) => teveJogo(clientesLegados[g.id], janela, null).then((sim) => (sim ? g.id : null)))
    ]);
    return montarVitrine({ grupos, legados, jogaram: new Set(achados.filter(Boolean)) });
  };
}
