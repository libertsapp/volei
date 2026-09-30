// Sessão própria do app (spec 2026-09-30-sessao-do-app-design.md). O Google só prova quem a pessoa é NO LOGIN; depois
// disso o servidor confia nesta sessão, que dura 90 dias e se renova a cada uso. Antes, o app usava o ID Token do
// Google (vence em 1 h) e a renovação silenciosa falhava muito no celular: a pessoa se sentia deslogada toda hora.
// O banco guarda só o hash SHA-256 do token: quem ler a tabela não consegue usar a sessão de ninguém.
// Só APIs que existem no Node e no Deno (crypto global, TextEncoder, btoa): este arquivo vai para a Edge Function.
export const MSG_SESSAO_EXPIRADA = 'Sua sessão expirou. Entre com o Google de novo.';
// falha do BANCO não é sessão vencida: o app não pode deslogar a pessoa por uma queda de um instante
export const MSG_SESSAO_SEM_BANCO = 'Não foi possível conferir sua sessão agora. Tente de novo.';

const DIA_MS = 24 * 60 * 60 * 1000;
const DURACAO_MS = 90 * DIA_MS;
const RENOVAR_A_CADA_MS = DIA_MS; // não grava no banco a cada clique: no máximo uma renovação por dia

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashDoToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function criarSessao({ repo, relogio }, email) {
  const agora = relogio();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const sessao = base64url(bytes);
  const expira = new Date(agora.getTime() + DURACAO_MS).toISOString();
  await repo.apagarSessoesVencidas(email, agora.toISOString()); // limpeza sem tarefa agendada
  await repo.inserirSessao({
    token_hash: await hashDoToken(sessao), email,
    criada_em: agora.toISOString(), expira_em: expira, renovada_em: agora.toISOString()
  });
  return { sessao, sessaoExpiraEm: expira };
}

export async function validarSessao({ repo, relogio }, token) {
  if (!token || typeof token !== 'string') return { ok: false, erro: MSG_SESSAO_EXPIRADA };
  const hash = await hashDoToken(token);
  let linha;
  try {
    linha = await repo.lerSessao(hash);
  } catch (e) {
    return { ok: false, erro: MSG_SESSAO_SEM_BANCO };
  }
  if (!linha) return { ok: false, erro: MSG_SESSAO_EXPIRADA };
  const agora = relogio();
  if (new Date(linha.expira_em).getTime() <= agora.getTime()) return { ok: false, erro: MSG_SESSAO_EXPIRADA };
  let expiraEm = new Date(linha.expira_em).toISOString();
  if (agora.getTime() - new Date(linha.renovada_em).getTime() >= RENOVAR_A_CADA_MS) {
    const nova = new Date(agora.getTime() + DURACAO_MS).toISOString();
    try {
      await repo.renovarSessao(hash, { expira_em: nova, renovada_em: agora.toISOString() });
      expiraEm = nova;
    } catch (e) { /* renovar é bônus: a sessão continua valendo até a validade antiga */ }
  }
  return { ok: true, email: linha.email, expiraEm };
}

export async function encerrarSessao({ repo }, token) {
  if (!token || typeof token !== 'string') return;
  await repo.apagarSessao(await hashDoToken(token));
}
