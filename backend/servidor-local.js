// Lançador do servidor local do Terça sobre o Supabase. Lê o .env, monta o handler de verdade e sobe em 127.0.0.1.
// Uso: node backend/servidor-local.js [porta]      (padrão 8000: a origem autorizada no Client ID do Google)
//   GRUPO=meme                                      (opcional: o Meme — schema meme, bucket fotos-meme, senha MEME_ADMIN_PASSWORD, HTML_MEME)
//   HTML_TERCA=<caminho do volei-dashboard.html>    (padrão: o da raiz do repositório)
//   BACKEND_URL=<url da Edge Function>              (opcional: a página local passa a falar com ela em vez do /api local)
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
const { configDoGrupo, opcoesDoCliente } = require('../scripts/lib/grupo.js');
const cfg = configDoGrupo(); // GRUPO=meme: schema, bucket, senha e HTML do Meme; sem GRUPO, o Terça como sempre

const obrigatorias = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', cfg.adminPasswordVar, 'GOOGLE_CLIENT_ID'];
const faltando = obrigatorias.filter((nome) => !process.env[nome]);
if (faltando.length) {
  console.error('Faltam no .env: ' + faltando.join(', '));
  process.exit(1);
}

const porta = Number(process.argv[2]) || 8000;
const arquivoHtml = process.env[cfg.htmlVar] || path.join(raiz, cfg.htmlPadrao);
const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opcoesDoCliente(cfg));
const handler = criarHandler({
  repo: criarRepoSupabase(cliente),
  armazenamento: criarArmazenamentoSupabase({ cliente, urlBase: process.env.SUPABASE_URL, bucket: cfg.bucket }),
  config: { adminPassword: process.env[cfg.adminPasswordVar] },
  verificarToken: criarVerificadorGoogle({ clientId: process.env.GOOGLE_CLIENT_ID }),
  avisar: (...a) => console.error(...a) // erros engolidos (ganchos do check-in, trava) ficam visíveis no terminal
});

criarServidor({ handler, arquivoHtml, urlApi: process.env.BACKEND_URL || undefined }).listen(porta, '127.0.0.1', () => console.log((cfg.grupo === 'meme' ? 'Meme' : 'Terça') + ' (Supabase) em http://localhost:' + porta + (process.env.BACKEND_URL ? ' (página falando com o backend remoto configurado em BACKEND_URL)' : '')));
