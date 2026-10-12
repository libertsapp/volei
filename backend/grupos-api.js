// Função dos grupos independentes (spec 2026-10-12): atende QUALQUER grupo pelo apelido. O grupo vem de "?g=" no GET e
// do campo "grupo" no POST; daí monta o handler de sempre (check-in, rodadas, financeiro, amistosos...) por cima do
// repositório daquele grupo — o domínio não sabe que existem vários grupos. As duas ações que acontecem ANTES de haver
// grupo (verificarApelido, criarGrupo) vivem só aqui, com limite por IP numa tabela global.
import { criarHandler } from './handler.js';
import { armazenamentoDoGrupo } from './armazenamento-grupo.js';
import { validarApelido, validarCadastroGrupo, normalizarApelido } from './grupos-cadastro.js';
import { normalizarIp } from './limitador.js';
import { mapearJogadores } from './mapeadores.js';
import { ErroDeNegocio, MSG_ERRO_INTERNO } from './erros.js';

export const MSG_MUITAS_CRIACOES = 'Muitas tentativas. Tente de novo mais tarde.';
const MAX_VERIFICACOES_POR_IP_HORA = 120;
const INEXISTENTE = { error: 'Esse grupo não existe.', codigo: 'grupo_inexistente' };
const SUSPENSO = { error: 'Grupo indisponível.', codigo: 'grupo_suspenso' };
const MSG_EM_USO = 'Esse endereço já está em uso. Escolha outro.';
const MENSAGENS = {
  apelido_invalido: 'Use só letras minúsculas, números e hífen no endereço.',
  apelido_reservado: 'Esse endereço é reservado. Escolha outro.',
  apelido_em_uso: MSG_EM_USO,
  limite_por_email: 'Por enquanto cada pessoa pode criar 1 grupo.'
};

export function criarGruposApi({
  cadastro, criarRepoDoGrupo, armazenamentoBase, repoLiga, verificarToken, relogio = () => new Date(),
  enviarPush, avisar = () => {}, registrar = () => {}, ocultarErrosInternos = false, cacheMs = 60000
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

  const dentroDoLimite = (prefixo, ip, max) => cadastro.registrarTentativaGlobal(prefixo + ':' + normalizarIp(ip), max, 3600, 3600);

  async function verificarApelido(b, contexto) {
    if (!(await dentroDoLimite('apelido', contexto.ip, MAX_VERIFICACOES_POR_IP_HORA))) return { error: MSG_MUITAS_CRIACOES };
    const apelido = normalizarApelido(b.apelido);
    const motivo = validarApelido(apelido);
    if (motivo) return { status: 'ok', disponivel: false, motivo };
    const livre = await cadastro.apelidoDisponivel(apelido);
    return { status: 'ok', disponivel: livre, motivo: livre ? '' : MSG_EM_USO };
  }

  async function criarGrupo(b, contexto) {
    const limites = await cadastro.lerLimites();
    // conta ANTES de tudo: tentativas que falham (sem login, dados ruins) também gastam o limite do IP
    if (!(await dentroDoLimite('criar', contexto.ip, limites.max_criacoes_por_ip_hora))) return { error: MSG_MUITAS_CRIACOES };
    const token = await verificarToken(b.idToken);
    if (!token.ok) return { error: token.erro };
    const v = validarCadastroGrupo(b.grupoNovo || {});
    if (v.erro) return { error: v.erro };
    try {
      await cadastro.criarGrupo({ ...v.dados, email: token.email, nomeDono: token.nome || '' });
    } catch (erro) {
      if (erro && erro.codigo && MENSAGENS[erro.codigo]) return { error: MENSAGENS[erro.codigo], codigo: erro.codigo };
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
        const r = await resolver(contexto.consulta && contexto.consulta.g);
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
        const r = await resolver(b.grupo);
        if (r.erro) return r.erro;
        if (acao === 'addPlayer') {
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
