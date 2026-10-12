// Servidor LOCAL dos grupos independentes, todo em memória (nada de Supabase): serve o app em qualquer caminho
// (/criar, /<apelido>/...) já em modo grupo e uma grupos-api de verdade por trás, para testar no navegador.
// Login de teste: idToken "dev:<email>" (só aqui; a função publicada usa o Google de verdade).
// Uso: npm run servidor-grupos [-- porta]   → http://localhost:8800/criar
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { criarGruposApi } from '../backend/grupos-api.js';
import { criarCadastroMemoria } from '../backend/cadastro-grupos-memoria.js';
import { criarRepoLigaMemoria } from '../backend/repo-liga-memoria.js';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RE_API = /const GRUPOS_API_URL = "[^"]*";/;
const RE_HOSTS = /const HOSTS_MODO_GRUPO = \[[^\]]*\];/;

function prepararHtml(texto) {
  if (!RE_API.test(texto) || !RE_HOSTS.test(texto)) throw new Error('HTML sem as linhas GRUPOS_API_URL / HOSTS_MODO_GRUPO: recusando (a página falaria com a produção).');
  return texto
    .replace(RE_API, 'const GRUPOS_API_URL = "/api";')
    .replace(RE_HOSTS, 'const HOSTS_MODO_GRUPO = ["volei.memberstars.com", "localhost", "127.0.0.1"];');
}

export function criarServidorGrupos({ arquivoHtml = path.join(raiz, 'volei-dashboard.html'), arquivoSw = path.join(raiz, 'sw.js') } = {}) {
  prepararHtml(fs.readFileSync(arquivoHtml, 'utf8')); // falha já na criação se o HTML não tiver as linhas
  const repoLiga = criarRepoLigaMemoria({ grupos: [{ id: 'terca', nome: 'Vôlei de Terça', cor: '#ffd700', cidade: 'Santa Luzia', uf: 'MG' }, { id: 'meme', nome: 'Vôlei Meme Brasil', cor: '#b3790a', cidade: 'Santa Luzia', uf: 'MG' }] });
  const cadastro = criarCadastroMemoria({ repoLiga });
  const verificarToken = async (t) => {
    const m = /^dev:([^@\s]+@[^@\s]+)$/.exec(String(t || ''));
    return m ? { ok: true, email: m[1].toLowerCase(), nome: m[1].split('@')[0] } : { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' };
  };
  const api = criarGruposApi({ cadastro, repoLiga, verificarToken, criarRepoDoGrupo: (id) => cadastro.repoDoGrupo(id), enviarPush: async () => {} });

  const servidor = http.createServer(async (req, res) => {
    const porta = servidor.address().port;
    const origensOk = [`http://localhost:${porta}`, `http://127.0.0.1:${porta}`];
    const url = new URL(req.url, 'http://localhost');
    const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
    try {
      if (url.pathname === '/api') {
        const consulta = Object.fromEntries(url.searchParams);
        if (req.method === 'GET') return json(await api.get({ consulta }));
        if (req.method === 'POST') {
          if (!origensOk.includes(req.headers.origin)) return json({ error: 'Origem não permitida.' }, 403);
          let corpo = '';
          for await (const pedaco of req) corpo += pedaco;
          return json(await api.post(JSON.parse(corpo || '{}'), { ip: '127.0.0.1', consulta }));
        }
        return json({ error: 'Método não permitido.' }, 405);
      }
      if (url.pathname === '/sw.js' || url.pathname.endsWith('/sw.js')) {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(fs.readFileSync(arquivoSw));
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(prepararHtml(fs.readFileSync(arquivoHtml, 'utf8')));
    } catch (erro) {
      json({ error: String(erro && erro.message ? erro.message : erro) }, 500);
    }
  });
  return servidor;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const porta = Number(process.argv[2]) || 8800;
  criarServidorGrupos().listen(porta, '127.0.0.1', () => console.log('Grupos (memória) em http://localhost:' + porta + '/criar — login de teste: idToken "dev:<email>"'));
}
