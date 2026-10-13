// Testes do bloco puro do modo grupo. Extrai <grupo-puro> do HTML. Rodar: node tests/grupo-puro.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <grupo-puro>');
const fim = html.indexOf('// </grupo-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <grupo-puro> não encontrado');
const G = new Function(html.slice(ini, fim) + `
  return { GRUPOS_API_URL, HOSTS_MODO_GRUPO, NOME_PADRAO_APP, UFS_GRUPO, PALETA_GRUPO, contextoDoGrupo, urlDaApi,
           chaveDoAparelho, caminhoCanonico, iniciaisDoGrupo, sugerirApelidoFront, sessaoParaGuardar };`)();
const backend = fs.readFileSync(path.join(__dirname, '..', 'backend', 'grupos-cadastro.js'), 'utf8');
const listaDoBackend = (nome) => new Function('return ' + backend.match(new RegExp('export const ' + nome + ' = (\\[[\\s\\S]*?\\]);'))[1])();

let falhas = 0;
function t(nome, fn){ try { fn(); console.log('ok    -', nome); } catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }
const HOSTS = ['volei.memberstars.com'];
const TERCA = 'https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/terca-api-teste';

t('linhas literais que os servidores locais reescrevem', () => {
  assert.match(html, /\nconst GRUPOS_API_URL = "https:\/\/lzwmirrjpoqucwlhgkku\.supabase\.co\/functions\/v1\/grupos-api";\n/);
  assert.match(html, /\nconst HOSTS_MODO_GRUPO = \["volei\.memberstars\.com"\];\n/);
});

t('Terça intacto: fora do host de grupos não há modo grupo e nada muda', () => {
  for (const host of ['memberstars.com', 'voleiterca.vercel.app', 'libertsapp.github.io', 'localhost', '127.0.0.1']) {
    const ctx = G.contextoDoGrupo(host, '/volei/', HOSTS);
    assert.equal(ctx, null, host);
    assert.equal(G.urlDaApi(TERCA, G.GRUPOS_API_URL, ctx), TERCA);
    for (const k of ['volei-auth-v1', 'volei-copia-dados-v1', 'volei-instalar-aviso-v2-fechado', 'volei-notif-pop-dispensado', 'placar-estado-terca-v1']) {
      assert.equal(G.chaveDoAparelho(k, ctx), k);
    }
    assert.equal(G.caminhoCanonico('/volei', ctx), null);
  }
  assert.equal(G.NOME_PADRAO_APP, 'Volei de Terça');
});

t('contextoDoGrupo: página de criação e grupo (apelido em minúsculas)', () => {
  assert.deepEqual(G.contextoDoGrupo('volei.memberstars.com', '/', HOSTS), { pagina: 'criar', apelido: '' });
  assert.deepEqual(G.contextoDoGrupo('volei.memberstars.com', '/criar', HOSTS), { pagina: 'criar', apelido: '' });
  assert.deepEqual(G.contextoDoGrupo('VOLEI.memberstars.com', '/Quinta/', HOSTS), { pagina: 'grupo', apelido: 'quinta' });
  assert.deepEqual(G.contextoDoGrupo('volei.memberstars.com', '/quinta/sw.js', HOSTS), { pagina: 'grupo', apelido: 'quinta' });
});

t('urlDaApi e chaveDoAparelho no modo grupo', () => {
  const ctx = { pagina: 'grupo', apelido: 'quinta' };
  assert.equal(G.urlDaApi(TERCA, G.GRUPOS_API_URL, ctx), G.GRUPOS_API_URL + '?g=quinta');
  assert.equal(G.urlDaApi(TERCA, G.GRUPOS_API_URL, { pagina: 'criar', apelido: '' }), G.GRUPOS_API_URL);
  assert.equal(G.chaveDoAparelho('volei-auth-v1', ctx), 'volei-g-quinta-auth-v1');
  assert.equal(G.chaveDoAparelho('placar-estado-terca-v1', ctx), 'placar-estado-g-quinta-terca-v1');
  assert.notEqual(G.chaveDoAparelho('volei-auth-v1', { pagina: 'grupo', apelido: 'sabado' }), G.chaveDoAparelho('volei-auth-v1', ctx));
});

t('caminhoCanonico: minúsculas e barra final (um app instalado por grupo)', () => {
  assert.equal(G.caminhoCanonico('/quinta/', { pagina: 'grupo', apelido: 'quinta' }), null);
  assert.equal(G.caminhoCanonico('/quinta', { pagina: 'grupo', apelido: 'quinta' }), '/quinta/');
  assert.equal(G.caminhoCanonico('/Quinta/', { pagina: 'grupo', apelido: 'quinta' }), '/quinta/');
  assert.equal(G.caminhoCanonico('/criar', { pagina: 'criar', apelido: '' }), null);
});

t('iniciais e sugestão de apelido', () => {
  assert.equal(G.iniciaisDoGrupo('Vôlei de Quinta'), 'VQ');
  assert.equal(G.iniciaisDoGrupo('Praia'), 'PR');
  assert.equal(G.iniciaisDoGrupo(''), '?');
  assert.equal(G.sugerirApelidoFront('Vôlei da Quinta!'), 'volei-da-quinta');
});

t('UFs e paleta iguais às do backend (grupos-cadastro.js)', () => {
  assert.deepEqual(G.UFS_GRUPO, listaDoBackend('UFS'));
  assert.deepEqual(G.PALETA_GRUPO, listaDoBackend('PALETA'));
});

t('fix: endereço com acento, espaço ou barra codificada NÃO redireciona (sem laço infinito nem ida para outro site)', () => {
  for (const caminho of ['/s%C3%A1bado/', '/a%20b/', '/%2Fevil.com/', '/%5Cevil.com/', '/%2F%2Fevil.com', '/..%2F..%2Fx/', '/ab/', '/a--b/']) {
    const ctx = G.contextoDoGrupo('volei.memberstars.com', caminho, HOSTS);
    assert.equal(G.caminhoCanonico(caminho, ctx), null, caminho);
  }
  // o certo continua sendo canonizado
  assert.equal(G.caminhoCanonico('/Quinta', G.contextoDoGrupo('volei.memberstars.com', '/Quinta', HOSTS)), '/quinta/');
});

t('fix: sessão que a página de criação guarda para o dono chegar logado (mesmo formato do salvarSessaoAuth)', () => {
  const s = G.sessaoParaGuardar({ status: 'ok', email: 'dono@x.com', nome: 'Dono', perfil: 'admin', jogadorId: '', jogadorIdPendente: '', sessao: 'S1', sessaoExpiraEm: '2026-11-12T00:00:00.000Z' }, 'TOKEN');
  assert.deepEqual(Object.keys(s).sort(), ['email', 'exp', 'foto', 'idToken', 'jogadorId', 'jogadorIdPendente', 'nome', 'perfil', 'sessao', 'sessaoExpiraEm']);
  assert.equal(s.sessao, 'S1');
  assert.equal(s.perfil, 'admin');
  assert.equal(G.sessaoParaGuardar({ error: 'x' }, 'TOKEN'), null);
  assert.equal(G.sessaoParaGuardar({ status: 'ok', email: 'a@x.com' }, 'TOKEN'), null); // sem sessão do app não guarda nada
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
