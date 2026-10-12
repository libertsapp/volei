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

export function validarApelido(s) {
  const a = normalizarApelido(s);
  if (a.length < 3 || a.length > 30) return 'O endereço precisa ter de 3 a 30 caracteres.';
  if (!FORMATO_APELIDO.test(a) || a.includes('--')) return 'Use só letras minúsculas, números e hífen (sem acento, sem espaço, sem hífen nas pontas).';
  if (APELIDOS_RESERVADOS.includes(a)) return 'Esse endereço é reservado. Escolha outro.';
  return '';
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
  const erroApelido = validarApelido(apelido);
  if (erroApelido) return { erro: erroApelido };
  const c = normalizarCidade(cidade);
  if (c.length < 2 || c.length > 60) return { erro: 'Informe a cidade do grupo.' };
  const u = texto(uf).trim().toUpperCase();
  if (!UFS.includes(u)) return { erro: 'Escolha o estado (UF).' };
  const cor_ = texto(cor).trim().toLowerCase();
  if (!PALETA.includes(cor_)) return { erro: 'Escolha uma das cores da paleta.' };
  return { dados: { nome: n, apelido: normalizarApelido(apelido), cidade: c, uf: u, cor: cor_ } };
}
