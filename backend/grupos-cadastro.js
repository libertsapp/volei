// Regras do cadastro de um grupo independente (spec 2026-10-12). O banco repete as mesmas regras (sql/grupos/
// schema-grupos.sql) — o teste sql-grupos confere que UFs, reservados e o formato do apelido batem nos dois lados.
// Aqui elas servem para responder rápido e em português na tela de criação; o banco é a última palavra.
export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE',
  'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

// cores de destaque oferecidas na criação: todas legíveis sobre o fundo escuro do app
export const PALETA = ['#ffd700', '#00f3ff', '#39ff9e', '#ff4d6d', '#b388ff', '#ff9f1c', '#4dabf7', '#f06595'];

export const APELIDOS_RESERVADOS = ['criar', 'admin', 'api', 'app', 'www', 'static', 'assets', 'sw', 'login', 'ajuda',
  'suporte', 'termos', 'privacidade', 'volei', 'voleimeme', 'terca', 'meme', 'memberstars',
  'porra', 'caralho', 'merda', 'puta', 'buceta', 'foda', 'viado'];

const FORMATO_APELIDO = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const PREPOSICOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
const texto = (v) => (v === undefined || v === null ? '' : String(v));

export const normalizarApelido = (s) => texto(s).trim();

// mesmo texto para a mesma recusa, venha ela do JS ou do criar_grupo do SQL (a tela confia no "codigo")
export const MENSAGENS_CADASTRO = {
  apelido_invalido: 'Use só letras minúsculas, números e hífen (sem acento, sem espaço, sem hífen nas pontas).',
  apelido_reservado: 'Esse endereço é reservado. Escolha outro.',
  apelido_em_uso: 'Esse endereço já está em uso. Escolha outro.',
  limite_por_email: 'Por enquanto cada pessoa pode criar 1 grupo.'
};

export function motivoDoApelido(s) {
  const a = normalizarApelido(s);
  if (a.length < 3 || a.length > 30) return { codigo: 'apelido_invalido', mensagem: 'O endereço precisa ter de 3 a 30 caracteres.' };
  if (!FORMATO_APELIDO.test(a) || a.includes('--')) return { codigo: 'apelido_invalido', mensagem: MENSAGENS_CADASTRO.apelido_invalido };
  if (APELIDOS_RESERVADOS.includes(a)) return { codigo: 'apelido_reservado', mensagem: MENSAGENS_CADASTRO.apelido_reservado };
  return null;
}

export function validarApelido(s) {
  const m = motivoDoApelido(s);
  return m ? m.mensagem : '';
}

export function sugerirApelido(nome) {
  return texto(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '');
}

export function normalizarCidade(s) {
  return texto(s).trim().split(/\s+/).filter(Boolean).map((p, i) => {
    const min = p.toLowerCase();
    if (i > 0 && PREPOSICOES.has(min)) return min;
    return min.charAt(0).toUpperCase() + min.slice(1);
  }).join(' ');
}

export function validarCadastroGrupo({ nome, apelido, cidade, uf, cor } = {}) {
  const n = texto(nome).trim().replace(/\s+/g, ' ');
  if (n.length < 3 || n.length > 60) return { erro: 'O nome do grupo precisa ter de 3 a 60 caracteres.' };
  const motivo = motivoDoApelido(apelido);
  if (motivo) return { erro: motivo.mensagem, codigo: motivo.codigo };
  const c = normalizarCidade(cidade);
  if (c.length < 2 || c.length > 60) return { erro: 'Informe a cidade do grupo.' };
  const u = texto(uf).trim().toUpperCase();
  if (!UFS.includes(u)) return { erro: 'Escolha o estado (UF).' };
  const cor_ = texto(cor).trim().toLowerCase();
  if (!PALETA.includes(cor_)) return { erro: 'Escolha uma das cores da paleta.' };
  return { dados: { nome: n, apelido: normalizarApelido(apelido), cidade: c, uf: u, cor: cor_ } };
}
