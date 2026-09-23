// Mini executor de testes (mesmo estilo dos outros testes do projeto: ok/FALHA + código de saída).
let falhas = 0;

export function t(nome, fn) {
  try { fn(); console.log('ok    -', nome); }
  catch (e) { falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

export async function ta(nome, fn) {
  try { await fn(); console.log('ok    -', nome); }
  catch (e) { falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

export function fim() {
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
}
