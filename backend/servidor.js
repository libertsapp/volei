// Servidor HTTP local (só Node): serve a página do app e a rota /api. Não sabe nada de banco nem de .env:
// recebe o handler pronto. Quem chama decide onde escutar (o lançador usa 127.0.0.1).
import http from 'node:http';
import fs from 'node:fs';

const REGEX_URL_API = /const SHEET_API_URL = "[^"]*";/;
const LIMITE_CORPO = 1024 * 1024; // 1 MB (a foto do app tem ~20 a 80 KB)

// Parâmetros da URL só para conferir telas no navegador (não dão privilégio nenhum no servidor):
//   ?perfil=admin  simula um usuário admin logado, só para ver as telas      ?view=financeiro  abre a tela
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

async function lerCorpo(req) {
  let total = 0;
  const pedacos = [];
  for await (const pedaco of req) {
    total += pedaco.length;
    if (total > LIMITE_CORPO) return null;
    pedacos.push(pedaco);
  }
  return Buffer.concat(pedacos).toString('utf8');
}

export function criarServidor({ handler, arquivoHtml }) {
  // confere já na criação: se o HTML foi reformatado e a URL não puder ser reescrita, a página falaria com a PRODUÇÃO
  if (!REGEX_URL_API.test(fs.readFileSync(arquivoHtml, 'utf8'))) {
    throw new Error('Não achei a linha "const SHEET_API_URL = ..." no HTML; recusando iniciar (a página apontaria para a produção).');
  }

  const servidor = http.createServer(async (req, res) => {
    const porta = servidor.address().port;
    const json = (objeto) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(objeto)); };
    const recusar = (status) => { res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end(); };
    try {
      // defesa contra páginas de outros sites falando com o localhost (e contra DNS rebinding)
      if (req.headers.host !== `localhost:${porta}` && req.headers.host !== `127.0.0.1:${porta}`) return recusar(403);

      const caminho = req.url.split('?')[0];
      if (caminho === '/api') {
        if (req.method === 'GET') return json(await handler.get());
        if (req.method === 'POST') {
          const origem = req.headers.origin;
          if (origem !== `http://localhost:${porta}` && origem !== `http://127.0.0.1:${porta}`) return recusar(403);
          if (Number(req.headers['content-length']) > LIMITE_CORPO) { res.writeHead(413, { Connection: 'close' }); res.end(); return req.destroy(); }
          const corpo = await lerCorpo(req);
          if (corpo === null) { res.writeHead(413, { Connection: 'close' });res.end(); return req.destroy(); }
          return json(await handler.post(JSON.parse(corpo || '{}')));
        }
        return recusar(405);
      }
      if (caminho !== '/') return recusar(404);

      const original = fs.readFileSync(arquivoHtml, 'utf8');
      const comUrl = original.replace(REGEX_URL_API, 'const SHEET_API_URL = "http://localhost:' + porta + '/api";');
      if (comUrl === original) throw new Error('Não achei a linha "const SHEET_API_URL = ..." no HTML; recusando servir a página (ela apontaria para a produção).');
      const html = comUrl.replace('</body>', INJECAO + '</body>');
      if (html === comUrl) throw new Error('Não achei a tag </body> no HTML; recusando servir a página sem a injeção.');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch (erro) {
      json({ error: String(erro && erro.message ? erro.message : erro) });
    }
  });
  return servidor;
}
