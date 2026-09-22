// Serve o volei-dashboard.html de verdade, apontando pro backend REAL (.gs rodando na planilha falsa).
// Uso: node tests/e2e/servidor-local.js [porta]   -> http://localhost:8765/?view=checkin&perfil=admin
// Parâmetros da URL: view=<tela>  perfil=admin (entra com a chave mestra)  clicar=<seletor CSS> (clica depois de carregar)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { criarAmbiente } = require('../helpers/planilha-falsa');

const raiz = path.join(__dirname, '..', '..');
const porta = Number(process.argv[2]) || 8765;
// MEME=1 serve o app e o backend do Vôlei Meme (planilha própria dele, outra senha); sem isso, o Terça
const MEME = !!process.env.MEME;
const SUF = ''; // planilhas separadas agora: Terça e Meme usam os mesmos nomes de aba
const SENHA = MEME ? '2026vmeme' : '131108';
// o HTML do Meme hoje vive como "volei-meme-dashboard - Copia.html" (o nome original sumiu da pasta); aceita os dois
const ARQ_MEME = require('fs').existsSync(require('path').join(__dirname, '..', '..', 'volei-meme-dashboard.html'))
  ? 'volei-meme-dashboard.html' : 'volei-meme-dashboard - Copia.html';
const ARQ_HTML = MEME ? ARQ_MEME : 'volei-dashboard.html';
const ARQ_GS = MEME ? 'apps-script-codigo-volei-meme.gs' : 'apps-script-codigo.gs';
const HOJE = '2026-09-18', ANTES = '2026-09-11';
const nomes = ['Cássia', 'Bruno', 'Thales', 'Markus', 'Ana F', 'Zelão', 'Diego', 'Camila', 'Pedro', 'Mateus', 'Leonardo', 'Pierre', 'Bibiana', 'Michel', 'Sara', 'Abraão'];
const ids = nomes.map((n, i) => 'p' + (i + 1));
const iso = (d, h) => d + 'T' + h + ':00:00.000Z';

const sementeBase = {
  Jogadores: [['id', 'nome', 'apelido', 'foto', 'estrelas', 'sexo', 'porte']].concat(nomes.map((n, i) => [ids[i], n, '', '', 3, i % 3 === 0 ? 'F' : 'M', ''])),
  Rodadas: [['roundId', 'data', 'timeIndex', 'timeNome', 'jogadores', 'vitorias', 'vencedor', 'rascunho']],
  Config: [['checkinDataAberta', HOJE], ['checkinTravado', 'FALSE'], ['checkinVagas', 16], ['checkinHorario', '20:00'], ['estrelasVisiveis', 'TRUE']],
  Checkins: [['id', 'data', 'jogadorId', 'jogadorNome', 'estrelas', 'sexo', 'estrelasAjustadas']]
    .concat(nomes.map((n, i) => ['c' + i, HOJE, ids[i], n, 3, 'M', '']))
    .concat(nomes.slice(0, 14).map((n, i) => ['d' + i, ANTES, ids[i], n, 3, 'M', ''])),
  Usuarios: [['email', 'nome', 'perfil', 'jogadorId', 'criadoEm', 'jogadorIdPendente']],
  FinDias: [['data', 'valorPessoa', 'pix', 'valorQuadra', 'temBrinde', 'valorBrinde', 'atualizadoPor', 'atualizadoEm', 'icone'],
    [HOJE, 13.6, '31987702331', 180, 'TRUE', 50, 'Adm', iso(HOJE, '18'), '✅'],
    [ANTES, 13.6, '31987702331', 180, 'FALSE', 0, 'Adm', iso(ANTES, '18'), '✅']],
  FinPagamentos: [['id', 'data', 'jogadorId', 'jogadorNome', 'valor', 'marcadoPor', 'marcadoEm', 'estornado', 'estornadoPor', 'estornadoEm']]
    .concat([13, 14, 15].map((i) => ['h' + i, HOJE, ids[i], nomes[i], 13.6, 'Adm', iso(HOJE, '19'), 'FALSE', '', '']))          // Michel, Sara, Abraão pagaram hoje
    .concat([['hx', HOJE, 'p99', 'Rafael', 13.6, 'Adm', iso(HOJE, '19'), 'FALSE', '', '']])                                    // pagou e saiu da lista
    .concat(nomes.slice(0, 14).map((n, i) => ['a' + i, ANTES, ids[i], n, 13.6, 'Adm', iso(ANTES, '19'), i === 3 ? 'TRUE' : 'FALSE', i === 3 ? 'Adm' : '', i === 3 ? iso(ANTES, '20') : ''])),
  FinLancamentos: [['id', 'data', 'tipo', 'descricao', 'valor', 'criadoPor', 'criadoEm', 'estornado', 'estornadoPor', 'estornadoEm'],
    ['l1', '2026-09-01', 'entrada', 'Saldo inicial', 500, 'Adm', iso('2026-09-01', '10'), 'FALSE', '', ''],
    ['l2', '2026-09-05', 'saida', 'Bola nova', 120, 'Adm', iso('2026-09-05', '10'), 'FALSE', '', '']],
  FinLog: [['timestamp', 'nome', 'email', 'acao', 'detalhe'],
    [iso(HOJE, '19'), 'Adm', 'adm@x.com', 'marcarPagamento', JSON.stringify({ data: HOJE, jogadorNome: 'Michel', valor: 13.6 })]]
};
const semente = Object.fromEntries(Object.entries(sementeBase).map(([nome, linhas]) => [nome + SUF, linhas]));
const amb = criarAmbiente(semente, [path.join(raiz, ARQ_GS)]);
amb.rodar('perfisPublicos_ = function(){ return []; }');
// login do Google é rede: no servidor de teste, qualquer idToken vale como organizador (só pra simular quem confirma presença)
amb.rodar(`
  verificarTokenGoogle_ = function(t){ return t ? { ok: true, email: 'org@teste.com', nome: 'Org Teste' } : { ok: false, erro: 'Faça o login do Google.' }; };
  perfilDoEmail_ = function(e){ return 'organizador'; };
  jogadorIdDoEmail_ = function(e){ return ''; };
`);

// injetado no fim da página: espera o app carregar, entra como admin (chave mestra), abre a tela e clica onde pedirem
const injecao = `<script>(function(){
  window.confirm = function(){ return true; };            // sem diálogo nativo no navegador headless
  // captura o que o app copia: o texto vai (URL-encoded) pro <title>, e dá pra ler com --dump-dom
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function(t){ document.title = 'COPIADO::' + encodeURIComponent(t); return Promise.resolve(); } } });
  var q = new URLSearchParams(location.search);
  var espera = setInterval(function(){
    var c = document.getElementById('loading');
    if(!c || c.style.display !== 'none') return;
    clearInterval(espera);
    if(q.get('perfil') === 'admin'){ setCachedPassword('${SENHA}'); updateAdminStatusBtn(); aplicarPermissoesUI(); }
    // perfil=jogador simula quem entrou com o Google como jogador comum (sem token de verdade; só serve pra ver a tela)
    if(q.get('perfil') === 'jogador'){ AUTH.logado = true; AUTH.perfil = 'jogador'; aplicarPermissoesUI(); }
    // sair=<ms>: depois desse tempo "sai da conta" (útil pra ver o que acontece com a página aberta)
    if(q.get('sair')){ setTimeout(function(){ AUTH.logado = false; aplicarPermissoesUI(); }, Number(q.get('sair'))); }
    if(q.get('tema') === 'claro'){ document.body.classList.add('light-mode'); }
    var v = q.get('view'); if(v){ document.querySelector('#nav button[data-view="' + v + '"]').click(); }
    // digitar=#campo=valor|#outro=valor  preenche campos (sem disparar evento); clicar=sel1|sel2|...  clica em sequência (400ms entre eles)
    var dig = q.get('digitar'); if(dig){ dig.split('|').forEach(function(p){ var i = p.indexOf('='); var el = document.querySelector(p.slice(0, i)); if(el) el.value = p.slice(i + 1); }); }
    var sel = q.get('clicar'); if(sel){ sel.split('|').forEach(function(s, k){ setTimeout(function(){ var el = document.querySelector(s); if(el) el.click(); }, 300 + k * 400); }); }
  }, 100);
})();</script>`;

http.createServer((req, res) => {
  if(req.url.startsWith('/api')){
    if(req.method === 'GET'){ res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(amb.get())); }
    let corpo = ''; req.on('data', (d) => corpo += d);
    return req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(amb.post(JSON.parse(corpo)))); });
  }
  let html = fs.readFileSync(path.join(raiz, ARQ_HTML), 'utf8')
    .replace(/const SHEET_API_URL = "[^"]*";/, 'const SHEET_API_URL = "http://localhost:' + porta + '/api";')
    .replace('</body>', injecao + '</body>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}).listen(porta, () => console.log('e2e em http://localhost:' + porta));
