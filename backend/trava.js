// Trava de gravação: o equivalente do LockService.getScriptLock().waitLock(15000) do Apps Script.
// O backend é HTTP sem estado (Node agora, Edge Function depois), então a exclusão mútua é um "aluguel" (lease) no banco:
// repo.pegarTrava(nome, dono, ttlSeg) -> boolean (atômico) e repo.soltarTrava(nome, dono). Se o processo morrer segurando a
// trava, ela expira sozinha depois do ttl. Uma única trava ('gravacao') protege o financeiro e o check-in juntos.
export const TTL_SEG = 30;          // aluguel: maior que qualquer ação do financeiro; expira sozinho se o processo cair
export const INTERVALO_MS = 150;    // de quanto em quanto tempo tenta de novo
export const LIMITE_MS = 15000;     // espera máxima (igual ao waitLock(15000) do .gs)
export const MSG_OCUPADO = 'O sistema está ocupado gravando outra alteração. Tente de novo em instantes.';

const esperaReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A espera é contada pela soma dos ms pedidos a deps.esperar (não pelo relógio): nos testes, um esperar falso torna tudo
// determinístico e instantâneo. O dono é único por chamada (deps.gerarDono, senão deps.gerarId, senão UUID); um erro do
// próprio pegarTrava (ex.: função inexistente porque o SQL do ajuste 5 não foi rodado) sobe: nunca segue "sem trava".
export async function comTrava(deps, nome, fn) {
  const gerar = deps.gerarDono || deps.gerarId || (() => globalThis.crypto.randomUUID());
  const esperar = deps.esperar || esperaReal;
  const dono = String(gerar());
  let esperado = 0;
  while (!(await deps.repo.pegarTrava(nome, dono, TTL_SEG))) {
    if (esperado >= LIMITE_MS) return { error: MSG_OCUPADO };
    await esperar(INTERVALO_MS);
    esperado += INTERVALO_MS;
  }
  try {
    return await fn();
  } finally {
    try { await deps.repo.soltarTrava(nome, dono); } catch { /* a trava expira sozinha; não esconde o resultado da ação */ }
  }
}
