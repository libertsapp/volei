// Copia backend/*.js (os módulos puros) para supabase/functions/terca-api-teste/backend/, byte a byte, para o
// "supabase functions deploy" enxergar tudo dentro de supabase/functions/. A pasta de destino é GERADA (está no .gitignore):
// rode de novo sempre que mexer em backend/. Não toca em rede, em .env nem no Supabase.
// Uso: npm run preparar-edge
const fs = require('node:fs');
const path = require('node:path');

const PROIBIDOS = [
  { rotulo: 'node:', regex: /node:/ },
  { rotulo: 'process.', regex: /\bprocess\./ },
  { rotulo: 'require(', regex: /\brequire\s*\(/ },
  { rotulo: 'Buffer', regex: /\bBuffer\b/ }
];

// Só os módulos que rodam também no Deno: .js do backend, menos o servidor local (usa http/fs do Node).
const deveCopiar = (nome) => /\.js$/.test(nome) && !/^servidor/.test(nome);

// Função pura (testável sem gravar nada): recebe [{ nome, conteudo }] e diz o que copiar e o que está impróprio.
// Linhas que são só comentário não contam (o fotos.js explica em comentário que não usa essas coisas).
function planejarCopia(arquivos) {
  const copiar = [];
  const ignorados = [];
  const problemas = [];
  for (const { nome, conteudo } of arquivos) {
    if (!deveCopiar(nome)) { ignorados.push(nome); continue; }
    copiar.push(nome);
    conteudo.split(/\r?\n/).forEach((linha, i) => {
      if (/^\s*\/\//.test(linha)) return;
      for (const p of PROIBIDOS) if (p.regex.test(linha)) problemas.push(`${nome}:${i + 1}: usa "${p.rotulo}" (não roda na Edge Function)`);
    });
    // especificadores de import/export: só './x.js' (o backend não tem dependências; um import "solto" quebraria no deploy ou traria código de fora)
    const semComentarios = conteudo.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const achados = [
      ...[...semComentarios.matchAll(/(?<![.\w$])from\s*(['"])([^'"]*)\1/g)].map((m) => m[2]),
      ...[...semComentarios.matchAll(/(?<![.\w$])import\s*(['"])([^'"]*)\1/g)].map((m) => m[2]),
      ...[...semComentarios.matchAll(/(?<![.\w$])import\s*\(\s*(['"])([^'"]*)\1/g)].map((m) => m[2])
    ];
    for (const e of achados) if (!e.startsWith('./')) problemas.push(`${nome}: especificador de import não relativo "${e}" (só ./arquivo.js é permitido)`);
    if (/(?<![.\w$])import\s*\(\s*[^'"\s)]/.test(semComentarios)) problemas.push(`${nome}: especificador de import dinâmico não literal (só ./arquivo.js literal é permitido)`);
  }
  return { copiar, ignorados, problemas };
}

const LEIA_ME = `ESTA PASTA É GERADA por "npm run preparar-edge" (scripts/preparar-edge.js). NÃO edite aqui:
edite backend/ e rode o comando de novo. Ela não vai para o git (.gitignore).
Cada arquivo é uma cópia idêntica, byte a byte, de backend/*.js (sem servidor*.js, que usa o Node).
`;

function executar() {
  const raiz = path.join(__dirname, '..');
  const origem = path.join(raiz, 'backend');
  const destino = path.join(raiz, 'supabase', 'functions', 'terca-api-teste', 'backend');
  const arquivos = fs.readdirSync(origem).filter((n) => fs.statSync(path.join(origem, n)).isFile())
    .map((nome) => ({ nome, conteudo: deveCopiar(nome) ? fs.readFileSync(path.join(origem, nome), 'utf8') : '' }));
  const plano = planejarCopia(arquivos);
  if (plano.problemas.length) {
    console.error('Recusando copiar: código do backend não compatível com a Edge Function:\n  ' + plano.problemas.join('\n  '));
    process.exit(1);
  }
  fs.rmSync(destino, { recursive: true, force: true }); // idempotente: sempre recomeça limpo (some arquivo removido do backend)
  fs.mkdirSync(destino, { recursive: true });
  for (const nome of plano.copiar) fs.copyFileSync(path.join(origem, nome), path.join(destino, nome));
  fs.writeFileSync(path.join(destino, 'LEIA-ME.txt'), LEIA_ME);
  console.log(`Copiados ${plano.copiar.length} arquivos para supabase/functions/terca-api-teste/backend/ (ignorados: ${plano.ignorados.join(', ')})`);
}

if (require.main === module) executar();
module.exports = { planejarCopia, deveCopiar };
