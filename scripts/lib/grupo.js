// Configuração de cada grupo: tudo o que muda entre o Terça (schema "public") e o Meme (schema "meme") fica aqui.
// Escolha pela variável GRUPO do ambiente (padrão: terca). Não guarda segredo: só NOMES de variáveis, de schema e de bucket.
const path = require('node:path');

const GRUPOS = {
  terca: {
    schema: 'public', bucket: 'fotos',
    spreadsheetIdVar: 'SPREADSHEET_ID_TERCA', adminPasswordVar: 'ADMIN_PASSWORD',
    htmlVar: 'HTML_TERCA', htmlPadrao: 'volei-dashboard.html'
  },
  meme: {
    schema: 'meme', bucket: 'fotos-meme',
    spreadsheetIdVar: 'SPREADSHEET_ID_MEME', adminPasswordVar: 'MEME_ADMIN_PASSWORD',
    htmlVar: 'HTML_MEME', htmlPadrao: path.join('..', 'voleimeme', 'index.html') // relativo à raiz do repositório volei
  }
};

function configDoGrupo(env = process.env) {
  const nome = String(env.GRUPO || 'terca').trim().toLowerCase();
  const g = GRUPOS[nome];
  if (!g) throw new Error('GRUPO inválido: "' + nome + '" (use terca ou meme)');
  return { grupo: nome, ...g, spreadsheetId: env[g.spreadsheetIdVar] || '' };
}

// opções do createClient do supabase-js: o schema "public" é o padrão dele; os outros precisam ser pedidos
function opcoesDoCliente(cfg) {
  return cfg.schema === 'public' ? {} : { db: { schema: cfg.schema } };
}

module.exports = { configDoGrupo, opcoesDoCliente, GRUPOS };
