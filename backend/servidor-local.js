// Servidor local: serve o volei-dashboard.html de verdade e a rota /api (o mesmo handler que vai
// virar Edge Function), lendo do Supabase. Só escuta em 127.0.0.1. A service_role fica só aqui.
// Uso: node backend/servidor-local.js [porta]
//   HTML_TERCA=<caminho do volei-dashboard.html>  (padrão: o da raiz do repositório)
// Parâmetros da URL para conferir telas (só no navegador, sem login de verdade nesta etapa):
//   ?perfil=admin  simula um usuário logado como admin (só para ver as telas)   ?view=financeiro  abre a tela
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { criarHandler } from './handler.js';
import { criarRepoSupabase } from './repo-supabase.js';

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(raiz, '.env'), quiet: true });
const { createClient } = require('@supabase/supabase-js');

const porta = Number(process.argv[2]) || 8770;
const arquivoHtml = process.env.HTML_TERCA || path.join(raiz, 'volei-dashboard.html');
const REGEX_URL_API = /const SHEET_API_URL = "[^"]*";/;
// confere já na partida: se o HTML foi reformatado e a URL não puder ser reescrita, o servidor nem sobe
if (!REGEX_URL_API.test(fs.readFileSync(arquivoHtml, 'utf8'))) {
  throw new Error('Não achei a linha "const SHEET_API_URL = ..." no HTML; recusando iniciar (a página apontaria para a produção).');
}
const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const handler = criarHandler({ repo: criarRepoSupabase(cliente) });

const INJECAO = `<script>(function(){
  var q = new URLSearchParams(location.search);
  var espera = setInterval(function(){
    var c = document.getElementById('loading');
    if(!c || c.style.display !== 'none') return;
    clearInterval(espera);
    if(q.get('perfil') === 'admin'){ AUTH.logado = true; AUTH.perfil = 'admin'; aplicarPermissoesUI(); }
    var v = q.get('view');
    if(v){ var b = document.querySelector('#nav button[data-view="' + v + '"]'); if(b) b.click(); }
  }, 100);
})();</script>`;

function responderJson(res, objeto) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(objeto));
}

http.createServer(async (req, res) => {
  try {
    const caminho = req.url.split('?')[0];
    if (caminho === '/api') {
      if (req.method === 'GET') return responderJson(res, await handler.get());
      if (req.method === 'POST') {
        let corpo = '';
        for await (const pedaco of req) corpo += pedaco;
        return responderJson(res, await handler.post(JSON.parse(corpo || '{}')));
      }
      res.writeHead(405); return res.end();
    }
    if (caminho !== '/') { res.writeHead(404); return res.end(); }
    const original = fs.readFileSync(arquivoHtml, 'utf8');
    const comUrl = original.replace(REGEX_URL_API, 'const SHEET_API_URL = "http://localhost:' + porta + '/api";');
    // se não mudou, a página continuaria apontando pro Apps Script de PRODUÇÃO: melhor falhar do que gravar lá sem querer
    if (comUrl === original) throw new Error('Não achei a linha "const SHEET_API_URL = ..." no HTML; recusando servir a página (ela apontaria para a produção).');
    const html = comUrl.replace('</body>', INJECAO + '</body>');
    if (html === comUrl) throw new Error('Não achei a tag </body> no HTML; recusando servir a página sem a injeção.');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  } catch (erro) {
    responderJson(res, { error: String(erro && erro.message ? erro.message : erro) });
  }
}).listen(porta, '127.0.0.1', () => console.log('Terça (Supabase) em http://localhost:' + porta));
