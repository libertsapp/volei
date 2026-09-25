// Regras de login, perfis e vínculos entre conta e jogador. Port de loginGoogle, bootstrapAdmin, listarUsuarios,
// salvarUsuario, removerUsuario, solicitarVinculo, aprovarVinculo, rejeitarVinculo e acharJogadorPorNome_ de
// apps-script-codigo.gs. As mensagens de erro são as mesmas do .gs (o app reconhece várias delas).
import { mapearJogadores, texto, porOrdem } from './mapeadores.js';
import { conferirChaveMestra, MSG_MUITAS_TENTATIVAS } from './limitador.js';

const PERFIS = ['admin', 'organizador', 'jogador'];
export const normalizarEmail = (v) => texto(v).trim().toLowerCase();

// "yyyy-MM-dd" no fuso de São Paulo (o .gs mostra a data de criação assim); en-CA já vem nesse formato
const formatoData = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
function dataSaoPaulo(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? texto(v) : formatoData.format(d);
}

// usuários no formato do app (equivale a readUsuarios do .gs), na ordem da planilha
export async function lerUsuarios(repo) {
  const linhas = (await repo.lerUsuarios()).slice().sort(porOrdem);
  return linhas.filter((u) => u.email).map((u) => ({
    email: normalizarEmail(u.email),
    nome: texto(u.nome),
    perfil: (texto(u.perfil) || 'jogador').trim().toLowerCase(),
    jogadorId: texto(u.jogador_id),
    criadoEm: dataSaoPaulo(u.criado_em),
    jogadorIdPendente: texto(u.jogador_id_pendente)
  }));
}

// Mesma regra do upsertUsuario_ do .gs: mexe só em nome, perfil e jogadorId (a data de criação nunca é
// reescrita); "jogadorIdPendente" só é sobrescrito se o chamador passar essa chave (mesmo vazia).
// ATENÇÃO (herdado do .gs): se o chamador não passar jogadorId, o vínculo aprovado é zerado.
async function gravar(repo, relogio, u) {
  const email = normalizarEmail(u.email);
  const perfil = (texto(u.perfil) || 'jogador').trim().toLowerCase();
  const brutos = await repo.lerUsuarios();
  const atual = brutos.find((x) => normalizarEmail(x.email) === email);
  const pendente = ('jogadorIdPendente' in u) ? texto(u.jogadorIdPendente) : (atual ? texto(atual.jogador_id_pendente) : '');
  const linha = { nome: texto(u.nome), perfil, jogador_id: texto(u.jogadorId) || null, jogador_id_pendente: pendente || null };
  if (atual) {
    await repo.gravarUsuario({ ...linha, email: atual.email });
  } else {
    // a "ordem" da linha nova vem do banco (sequência); no repositório em memória é máximo + 1
    await repo.gravarUsuario({ ...linha, email, criado_em: relogio().toISOString() });
  }
}

// Compara nomes sem tropeçar em acento, maiúscula, ponto ou espaço duplo
function normalizarNome(s) {
  return texto(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Palpite de qual jogador cadastrado é o dono da conta, pelo nome; no máximo UM, e na dúvida não palpita.
export function acharJogadorPorNome(players, nomeConta) {
  const alvo = normalizarNome(nomeConta);
  if (!alvo) return null;
  let achado = players.filter((p) => normalizarNome(p.nome) === alvo || (p.apelido && normalizarNome(p.apelido) === alvo))[0];
  if (achado) return { id: achado.id, nome: achado.nome, motivo: 'exato' };

  const partesAlvo = alvo.split(' ');
  if (partesAlvo.length >= 2) {
    const chaveAlvo = partesAlvo[0] + ' ' + partesAlvo[partesAlvo.length - 1];
    achado = players.filter((p) => {
      const partes = normalizarNome(p.nome).split(' ');
      return partes.length >= 2 && (partes[0] + ' ' + partes[partes.length - 1]) === chaveAlvo;
    })[0];
    if (achado) return { id: achado.id, nome: achado.nome, motivo: 'parecido' };
  }

  const comMesmoPrimeiro = players.filter((p) => normalizarNome(p.nome).split(' ')[0] === partesAlvo[0]);
  if (comMesmoPrimeiro.length === 1) return { id: comMesmoPrimeiro[0].id, nome: comMesmoPrimeiro[0].nome, motivo: 'parecido' };
  return null;
}

async function sugerirJogador(repo, nomeConta) {
  return acharJogadorPorNome(mapearJogadores(await repo.lerJogadores()), nomeConta);
}

export async function loginGoogle({ repo, relogio, verificarToken }, body) {
  const token = await verificarToken(body.idToken);
  if (!token.ok) return { error: token.erro };

  const usuarios = await lerUsuarios(repo);
  const existente = usuarios.find((u) => u.email === token.email);

  if (existente) {
    // o nome da conta Google pode ter mudado: mantém a planilha atualizada, sem tocar no perfil
    if (existente.nome !== token.nome && token.nome) {
      await gravar(repo, relogio, { email: existente.email, nome: token.nome, perfil: existente.perfil, jogadorId: existente.jogadorId });
    }
    return {
      status: 'ok', email: existente.email, nome: token.nome || existente.nome,
      perfil: existente.perfil || 'jogador', jogadorId: existente.jogadorId, jogadorIdPendente: existente.jogadorIdPendente,
      // já vinculado OU já com pedido em análise: não repete a sugestão de vínculo
      sugestao: (existente.jogadorId || existente.jogadorIdPendente) ? null : await sugerirJogador(repo, token.nome),
      primeiroLogin: false, totalUsuarios: usuarios.length
    };
  }

  await gravar(repo, relogio, { email: token.email, nome: token.nome, perfil: 'jogador', jogadorId: '' });
  return {
    status: 'ok', email: token.email, nome: token.nome, perfil: 'jogador', jogadorId: '', jogadorIdPendente: '',
    sugestao: await sugerirJogador(repo, token.nome), primeiroLogin: true, totalUsuarios: usuarios.length + 1
  };
}

// Promove a admin quem está logado com Google E informou a chave mestra (idempotente; nunca perde o vínculo)
export async function bootstrapAdmin({ repo, relogio, config, verificarToken, limitador }, body, contexto = {}) {
  const conferencia = await conferirChaveMestra({ config, limitador }, contexto, body.senha);
  if (conferencia.bloqueado) return { error: MSG_MUITAS_TENTATIVAS };
  if (!conferencia.igual) return { error: 'Chave mestra incorreta.' };
  const token = await verificarToken(body.idToken);
  if (!token.ok) return { error: token.erro };
  const existente = (await lerUsuarios(repo)).find((u) => u.email === token.email);
  const jogadorId = existente ? existente.jogadorId : '';
  await gravar(repo, relogio, { email: token.email, nome: token.nome, perfil: 'admin', jogadorId });
  return { status: 'ok', email: token.email, nome: token.nome, perfil: 'admin', jogadorId };
}

// Organizador recebe a lista SEM o "perfil" de ninguém (defesa em profundidade: nunca sai do backend)
export async function listarUsuarios({ repo }, perfilDeQuemPediu) {
  const usuarios = await lerUsuarios(repo);
  if (perfilDeQuemPediu === 'admin') return { usuarios };
  return { usuarios: usuarios.map((u) => ({ email: u.email, nome: u.nome, jogadorId: u.jogadorId, criadoEm: u.criadoEm, jogadorIdPendente: u.jogadorIdPendente })) };
}

export async function salvarUsuario({ repo, relogio }, u) {
  if (!u || !u.email) return { error: 'E-mail do usuário é obrigatório.' };
  const perfil = texto(u.perfil || 'jogador').trim().toLowerCase();
  if (!PERFIS.includes(perfil)) return { error: 'Perfil inválido: ' + u.perfil };
  const email = normalizarEmail(u.email);
  const usuarios = await lerUsuarios(repo);
  const atual = usuarios.find((x) => x.email === email);

  // sem admin nenhum ninguém mais gerencia nada (só sobra a chave mestra): o último admin não pode se rebaixar
  if (atual && atual.perfil === 'admin' && perfil !== 'admin') {
    if (usuarios.filter((x) => x.perfil === 'admin').length <= 1) {
      return { error: 'Não é possível rebaixar o último administrador. Promova outro admin primeiro.' };
    }
  }

  const jogadorId = texto(u.jogadorId);
  if (jogadorId) {
    const jogadores = mapearJogadores(await repo.lerJogadores());
    if (!jogadores.some((p) => p.id === jogadorId)) return { error: 'O jogador escolhido não existe mais na aba Jogadores.' };
    const jaUsado = usuarios.find((x) => x.jogadorId === jogadorId && x.email !== email);
    if (jaUsado) return { error: 'Esse jogador já está vinculado ao e-mail ' + jaUsado.email + '.' };
  }

  // quem decide o jogadorId (aprovando um pedido ou editando à mão) resolve qualquer pedido pendente
  await gravar(repo, relogio, { email, nome: texto(u.nome || (atual && atual.nome)), perfil, jogadorId, jogadorIdPendente: '' });
  return { status: 'ok' };
}

export async function removerUsuario({ repo }, email) {
  const alvo = normalizarEmail(email);
  const usuarios = await lerUsuarios(repo);
  const atual = usuarios.find((x) => x.email === alvo);
  if (!atual) return { error: 'Usuário não encontrado (pode já ter sido removido).' };
  if (atual.perfil === 'admin' && usuarios.filter((x) => x.perfil === 'admin').length <= 1) {
    return { error: 'Não é possível remover o último administrador. Promova outro admin primeiro.' };
  }
  const bruto = (await repo.lerUsuarios()).find((x) => normalizarEmail(x.email) === alvo);
  if (!bruto) return { error: 'Usuário não encontrado (pode já ter sido removido).' };
  await repo.removerUsuario(bruto.email);
  return { status: 'ok' };
}

// Pedido de vínculo entre a conta logada e um jogador: NÃO vincula na hora, fica pendente até alguém aprovar.
// Só mexe na linha do PRÓPRIO e-mail autenticado (por isso recebe o "auth" do porteiro, nunca um e-mail do cliente).
export async function solicitarVinculo({ repo, relogio }, auth, jogadorId) {
  if (!auth.email) return { error: 'Essa ação precisa de login com conta Google (a chave mestra não identifica uma pessoa).' };
  const alvo = texto(jogadorId);

  if (!alvo) {
    await gravar(repo, relogio, { email: auth.email, nome: auth.nome, perfil: auth.perfil, jogadorIdPendente: '' });
    return { status: 'ok', jogadorIdPendente: '' };
  }

  const jogadores = mapearJogadores(await repo.lerJogadores());
  if (!jogadores.some((p) => p.id === alvo)) return { error: 'O jogador escolhido não existe mais na aba Jogadores.' };

  const usuarios = await lerUsuarios(repo);
  const jaAprovado = usuarios.find((x) => x.jogadorId === alvo && x.email !== auth.email);
  if (jaAprovado) return { error: 'Esse jogador já está vinculado ao e-mail ' + jaAprovado.email + '.' };
  const jaPendente = usuarios.find((x) => x.jogadorIdPendente === alvo && x.email !== auth.email);
  if (jaPendente) return { error: 'Já existe outro pedido de vínculo pendente pra esse jogador. Fale com o administrador.' };

  await gravar(repo, relogio, { email: auth.email, nome: auth.nome, perfil: auth.perfil, jogadorIdPendente: alvo });
  return { status: 'ok', jogadorIdPendente: alvo };
}

// Admin ou organizador confirma um pedido pendente (pode corrigir para outro jogador). Nunca mexe no cargo.
export async function aprovarVinculo(deps, email, jogadorIdEscolhido) {
  const alvo = normalizarEmail(email);
  const atual = (await lerUsuarios(deps.repo)).find((u) => u.email === alvo);
  if (!atual) return { error: 'Usuário não encontrado.' };
  if (!atual.jogadorIdPendente) return { error: 'Esse usuário não tem nenhum pedido de vínculo pendente.' };
  const jogadorId = jogadorIdEscolhido ? texto(jogadorIdEscolhido) : atual.jogadorIdPendente;
  return salvarUsuario(deps, { email: atual.email, nome: atual.nome, perfil: atual.perfil, jogadorId });
}

// Recusa um pedido pendente: só apaga o pedido (mas veja o aviso em gravar: o vínculo aprovado também é zerado)
export async function rejeitarVinculo({ repo, relogio }, email) {
  const alvo = normalizarEmail(email);
  const atual = (await lerUsuarios(repo)).find((u) => u.email === alvo);
  if (!atual) return { error: 'Usuário não encontrado.' };
  await gravar(repo, relogio, { email: atual.email, nome: atual.nome, perfil: atual.perfil, jogadorIdPendente: '' });
  return { status: 'ok' };
}
