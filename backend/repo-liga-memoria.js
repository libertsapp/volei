// Repositório da LIGA (schema "liga", compartilhado entre os grupos) em memória: mesma interface do repo-liga-supabase.
// Um ÚNICO objeto destes pode ser entregue a dois handlers (Terça e Meme) nos testes — é assim que se simula os dois
// grupos conversando pelo mesmo banco. Faz o papel do banco onde importa: chave primária, chaves estrangeiras para
// grupos, unique da escalação e o "update ... where status = X" da concorrência otimista.
const copia = (x) => structuredClone(x);

export function criarRepoLigaMemoria(dados = {}) {
  const t = {
    grupos: (dados.grupos || []).map((l) => ({ ativo: true, ...l })),
    amistosos: (dados.amistosos || []).map((l) => ({ ...l })),
    amistoso_mensagens: (dados.amistoso_mensagens || []).map((l) => ({ ...l })),
    escalacoes: (dados.escalacoes || []).map((l) => ({ ...l })),
    travas_escalacao: (dados.travas_escalacao || []).map((l) => ({ ...l }))
  };
  const doAmistoso = (lista, id) => lista.filter((l) => l.amistoso_id === id);
  const mesmaEscalacao = (e, amistosoId, grupo, jogadorId) => e.amistoso_id === amistosoId && e.grupo === grupo && e.jogador_id === jogadorId;

  return {
    tabelas: t,
    async lerGrupos() { return copia(t.grupos); },
    async lerAmistososDoGrupo(grupoId) {
      const amistosos = t.amistosos.filter((a) => a.grupo_convidante === grupoId || a.grupo_convidado === grupoId);
      const ids = new Set(amistosos.map((a) => a.id));
      return copia({
        amistosos,
        mensagens: t.amistoso_mensagens.filter((m) => ids.has(m.amistoso_id)),
        escalacoes: t.escalacoes.filter((e) => ids.has(e.amistoso_id)),
        travas: t.travas_escalacao.filter((x) => ids.has(x.amistoso_id))
      });
    },
    async lerAmistoso(id) {
      const a = t.amistosos.find((x) => x.id === id);
      if (!a) return null;
      return copia({ amistoso: a, escalacoes: doAmistoso(t.escalacoes, id), travas: doAmistoso(t.travas_escalacao, id) });
    },
    async inserirAmistoso(linha) {
      if (t.amistosos.some((a) => a.id === linha.id)) throw new Error('amistosos: duplicate key value violates unique constraint "amistosos_pkey"');
      for (const g of [linha.grupo_convidante, linha.grupo_convidado]) {
        if (!t.grupos.some((x) => x.id === g)) throw new Error('amistosos: insert or update on table "amistosos" violates foreign key constraint');
      }
      t.amistosos.push({ ...linha });
    },
    // atualiza SÓ se o status ainda é o esperado; quem chegou depois recebe false e não sobrescreve quem agiu primeiro
    async atualizarAmistosoSe(id, statusEsperado, campos) {
      const i = t.amistosos.findIndex((a) => a.id === id && a.status === statusEsperado);
      if (i === -1) return false;
      t.amistosos[i] = { ...t.amistosos[i], ...campos };
      return true;
    },
    // mesmo CHECK do banco (char_length(texto) <= 500): sem isto os testes não pegariam texto montado grande demais
    async inserirMensagem(linha) {
      if (String(linha.texto || '').length > 500) throw new Error('amistoso_mensagens: new row violates check constraint "amistoso_mensagens_texto_check"');
      t.amistoso_mensagens.push({ ...linha });
    },
    // false = a pessoa já está na lista desse grupo nesse amistoso (o unique do banco)
    async inserirEscalacao(linha) {
      if (t.escalacoes.some((e) => mesmaEscalacao(e, linha.amistoso_id, linha.grupo, linha.jogador_id))) return false;
      t.escalacoes.push({ status: 'interessado', ...linha });
      return true;
    },
    async atualizarEscalacao(amistosoId, grupo, jogadorId, campos) {
      const i = t.escalacoes.findIndex((e) => mesmaEscalacao(e, amistosoId, grupo, jogadorId));
      if (i === -1) return false;
      t.escalacoes[i] = { ...t.escalacoes[i], ...campos };
      return true;
    },
    async removerEscalacao(amistosoId, grupo, jogadorId) {
      const antes = t.escalacoes.length;
      t.escalacoes = t.escalacoes.filter((e) => !mesmaEscalacao(e, amistosoId, grupo, jogadorId));
      return t.escalacoes.length < antes;
    },
    async definirTrava(amistosoId, grupo, travada) {
      const existe = t.travas_escalacao.some((x) => x.amistoso_id === amistosoId && x.grupo === grupo);
      if (travada && !existe) t.travas_escalacao.push({ amistoso_id: amistosoId, grupo });
      if (!travada) t.travas_escalacao = t.travas_escalacao.filter((x) => !(x.amistoso_id === amistosoId && x.grupo === grupo));
    }
  };
}
