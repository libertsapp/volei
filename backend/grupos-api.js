// Função dos grupos independentes (spec 2026-10-12): atende QUALQUER grupo pelo apelido. O grupo vem de "?g=" no GET e
// do campo "grupo" no POST; daí monta o handler de sempre (check-in, rodadas, financeiro, amistosos...) por cima do
// repositório daquele grupo — o domínio não sabe que existem vários grupos. As duas ações que acontecem ANTES de haver
// grupo (verificarApelido, criarGrupo) vivem só aqui, com limite por IP numa tabela global.
import { criarHandler } from './handler.js';
import { armazenamentoDoGrupo } from './armazenamento-grupo.js';
import { motivoDoApelido, validarCadastroGrupo, normalizarApelido, MENSAGENS_CADASTRO } from './grupos-cadastro.js';
import { normalizarIp } from './limitador.js';
import { mapearJogadores } from './mapeadores.js';
import { ErroDeNegocio, MSG_ERRO_INTERNO } from './erros.js';

export const MSG_MUITAS_CRIACOES = 'Muitas tentativas. Tente de novo mais tarde.';
const MAX_VERIFICACOES_POR_IP_HORA = 120;
const INEXISTENTE = { error: 'Esse grupo não existe.', codigo: 'grupo_inexistente' };
const SUSPENSO = { error: 'Grupo indisponível.', codigo: 'grupo_suspenso' };

export function criarGruposApi({
  cadastro, criarRepoDoGrupo, armazenamentoBase, repoLiga, verificarToken, relogio = () => new Date(),
  enviarPush, avisar = () => {}, registrar = () => {}, ocultarErrosInternos = false, cacheMs = 60000, lerVitrine = null
}) {
  // cache curto só de grupos ACHADOS (nunca de "não existe"): um grupo recém-criado responde na hora
  const cache = new Map();

  async function resolver(apelidoBruto) {
    const apelido = normalizarApelido(apelidoBruto).toLowerCase();
    if (!apelido) return { erro: INEXISTENTE };
    const agora = relogio().getTime();
    const guardado = cache.get(apelido);
    let grupo = guardado && guardado.ate > agora ? guardado.grupo : null;
    if (!grupo) {
      grupo = await cadastro.lerGrupoPorApelido(apelido);
      if (grupo) cache.set(apelido, { grupo, ate: agora + cacheMs });
    }
    if (!grupo) return { erro: INEXISTENTE };
    if (grupo.status !== 'ativo') return { erro: SUSPENSO };
    return { grupo };
  }

  const publico = (g) => ({ apelido: g.apelido, nome: g.nome, cidade: g.cidade, uf: g.uf, cor: g.cor_destaque, logoUrl: g.logo_url || '', plano: g.plano });

  // vitrine pública (memberstars.com, "Grupos em quadra"): 5 minutos em memória; falha não fica guardada
  const VITRINE_MS = 5 * 60 * 1000;
  let vitrineGuardada = null;
  async function vitrine() {
    if (!lerVitrine) return { error: 'Lista de grupos indisponível.' };
    const agora = relogio().getTime();
    if (vitrineGuardada && vitrineGuardada.ate > agora) return vitrineGuardada.dados;
    const dados = await lerVitrine();
    vitrineGuardada = { dados, ate: agora + VITRINE_MS };
    return dados;
  }

  // um handler por requisição: barato (só monta objetos) e sem estado compartilhado entre grupos
  const handlerDo = (g) => criarHandler({
    repo: criarRepoDoGrupo(g.id),
    config: { adminPassword: '' }, // sem chave mestra nos grupos novos (como Terça e Meme desde a v16.0)
    verificarToken, relogio, enviarPush, avisar, registrar, ocultarErrosInternos,
    armazenamento: armazenamentoBase ? armazenamentoDoGrupo(armazenamentoBase, g.id) : undefined,
    liga: repoLiga ? { repo: repoLiga, grupoId: g.apelido } : undefined
  });

  const falhaInesperada = (erro) => {
    if (ocultarErrosInternos && !(erro instanceof ErroDeNegocio)) {
      try { registrar(erro); } catch { /* nada */ }
      return { error: MSG_ERRO_INTERNO };
    }
    return { error: String(erro && erro.message ? erro.message : erro) };
  };

  // Sem o IP de verdade (cabeçalho cf-connecting-ip ausente), todo mundo cairia num balde só e 3 tentativas de qualquer
  // pessoa trancariam a criação de grupos do país inteiro por 1 hora. Nesse caso o balde comum ganha um teto bem maior:
  // ainda segura um robô, mas não deixa gente de verdade travar umas às outras.
  const MULTIPLICADOR_SEM_IP = 50;
  const dentroDoLimite = (prefixo, ip, max) => {
    const conhecido = !!ip && ip !== 'desconhecido';
    const chave = prefixo + ':' + (conhecido ? normalizarIp(ip) : 'desconhecido');
    return cadastro.registrarTentativaGlobal(chave, conhecido ? max : max * MULTIPLICADOR_SEM_IP, 3600, 3600);
  };

  async function verificarApelido(b, contexto) {
    if (!(await dentroDoLimite('apelido', contexto.ip, MAX_VERIFICACOES_POR_IP_HORA))) return { error: MSG_MUITAS_CRIACOES };
    const apelido = normalizarApelido(b.apelido);
    const motivo = motivoDoApelido(apelido);
    if (motivo) return { status: 'ok', disponivel: false, motivo: motivo.mensagem, codigo: motivo.codigo };
    const livre = await cadastro.apelidoDisponivel(apelido);
    return livre
      ? { status: 'ok', disponivel: true, motivo: '', codigo: '' }
      : { status: 'ok', disponivel: false, motivo: MENSAGENS_CADASTRO.apelido_em_uso, codigo: 'apelido_em_uso' };
  }


  async function criarGrupo(b, contexto) {
    const limites = await cadastro.lerLimites();
    // conta ANTES de tudo: tentativas que falham (sem login, dados ruins) também gastam o limite do IP
    if (!(await dentroDoLimite('criar', contexto.ip, limites.max_criacoes_por_ip_hora))) return { error: MSG_MUITAS_CRIACOES };
    const token = await verificarToken(b.idToken);
    if (!token.ok) return { error: token.erro };
    const v = validarCadastroGrupo(b.grupoNovo || {});
    if (v.erro) return v.codigo ? { error: v.erro, codigo: v.codigo } : { error: v.erro };
    try {
      await cadastro.criarGrupo({ ...v.dados, email: token.email, nomeDono: token.nome || '' });
    } catch (erro) {
      if (erro && erro.codigo && MENSAGENS_CADASTRO[erro.codigo]) return { error: MENSAGENS_CADASTRO[erro.codigo], codigo: erro.codigo };
      throw erro;
    }
    cache.delete(v.dados.apelido);
    return { status: 'ok', apelido: v.dados.apelido };
  }

  async function tetoDeJogadores(g) {
    const limites = await cadastro.lerLimites();
    const ativos = mapearJogadores(await criarRepoDoGrupo(g.id).lerJogadores()).length; // sem convidados nem removidos
    if (ativos >= limites.max_jogadores_por_grupo) return { error: 'Este grupo chegou ao limite de ' + limites.max_jogadores_por_grupo + ' jogadores do plano grátis.' };
    return null;
  }

  return {
    async get(contexto = {}) {
      try {
        const consulta = contexto.consulta || {};
        if (consulta.lista === 'grupos') return await vitrine();
        const r = await resolver(consulta.g);
        if (r.erro) return r.erro;
        const dados = await handlerDo(r.grupo).get();
        if (dados.error) return dados;
        return { ...dados, grupo: publico(r.grupo) };
      } catch (erro) {
        return falhaInesperada(erro);
      }
    },

    async post(body, contexto = {}) {
      try {
        const b = body || {};
        const acao = String(b.action || '');
        if (acao === 'verificarApelido') return await verificarApelido(b, contexto);
        if (acao === 'criarGrupo') return await criarGrupo(b, contexto);
        // ⏰ lembrete do dia (v19.2): o agendador chama UMA vez para todos os grupos. Público como o lembreteDoDia, mas
        // passa por todos os grupos: limite global de 12 chamadas por hora (o agendador faz 4) para ninguém usar de martelo
        if (acao === 'lembretesAgendados') {
          if (!(await cadastro.registrarTentativaGlobal('lembretes', 12, 3600, 3600))) return { error: MSG_MUITAS_CRIACOES };
          const grupos = await cadastro.listarGruposAtivos();
          let lembretes = 0;
          for (const g of grupos) {
            try { lembretes += (await handlerDo(g).post({ action: 'lembreteDoDia' })).lembretes || 0; }
            catch (e) { try { avisar('lembrete do grupo ' + g.apelido + ': ' + (e && e.message)); } catch { /* nada */ } }
          }
          return { status: 'ok', grupos: grupos.length, lembretes };
        }
        const r = await resolver(b.grupo || (contexto.consulta && contexto.consulta.g));
        if (r.erro) return r.erro;
        // reativar um removido também aumenta os ativos: sem isso, remover/cadastrar/reativar furava o teto
        if (acao === 'addPlayer' || acao === 'restorePlayer') {
          const teto = await tetoDeJogadores(r.grupo);
          if (teto) return teto;
        }
        return await handlerDo(r.grupo).post(b, contexto);
      } catch (erro) {
        return falhaInesperada(erro);
      }
    }
  };
}
