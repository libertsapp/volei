// Lançador do servidor local do Terça sobre o Supabase. Lê o .env, monta o handler de verdade e sobe em 127.0.0.1.
// Uso: node backend/servidor-local.js [porta]      (padrão 8000: a origem autorizada no Client ID do Google)
//   HTML_TERCA=<caminho do volei-dashboard.html>    (padrão: o da raiz do repositório)
// A service_role, a chave mestra e o Client ID ficam só neste processo; nada disso vai para o navegador.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { criarHandler } from './handler.js';
import { criarRepoSupabase } from './repo-supabase.js';
import { criarArmazenamentoSupabase } from './armazenamento-supabase.js';
import { criarVerificadorGoogle } from './auth.js';
import { criarServidor } from './servidor.js';

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(raiz, '.env'), quiet: true });
const { createClient } = require('@supabase/supabase-js');

const obrigatorias = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PASSWORD', 'GOOGLE_CLIENT_ID'];
const faltando = obrigatorias.filter((nome) => !process.env[nome]);
if (faltando.length) {
  console.error('Faltam no .env: ' + faltando.join(', '));
  process.exit(1);
}

const porta = Number(process.argv[2]) || 8000;
const arquivoHtml = process.env.HTML_TERCA || path.join(raiz, 'volei-dashboard.html');
const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const handler = criarHandler({
  repo: criarRepoSupabase(cliente),
  armazenamento: criarArmazenamentoSupabase({ cliente, urlBase: process.env.SUPABASE_URL }),
  config: { adminPassword: process.env.ADMIN_PASSWORD },
  verificarToken: criarVerificadorGoogle({ clientId: process.env.GOOGLE_CLIENT_ID }),
  avisar: (...a) => console.error(...a) // erros engolidos (ganchos do check-in, trava) ficam visíveis no terminal
});

criarServidor({ handler, arquivoHtml }).listen(porta, '127.0.0.1', () => console.log('Terça (Supabase) em http://localhost:' + porta));
