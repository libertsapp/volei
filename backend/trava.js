// Trava de gravação: o equivalente do LockService.getScriptLock().waitLock(15000) do Apps Script.
// O backend é HTTP sem estado (Node agora, Edge Function depois), então a exclusão mútua é um "aluguel" (lease) no banco:
// repo.pegarTrava(nome, dono, ttlSeg) -> boolean (atômico) e repo.soltarTrava(nome, dono). Se o processo morrer segurando a
// trava, ela expira sozinha depois do ttl. Uma única trava ('gravacao') protege o financeiro e o check-in juntos.
export const TTL_SEG = 30;          // aluguel: maior que qualquer ação do financeiro; expira sozinho se o processo cair
export const INTERVALO_MS = 150;    // de quanto em quanto tempo tenta de novo
export const LIMITE_MS = 15000;     // espera máxima (igual ao waitLock(15000) do .gs)
export const MSG_OCUPADO = 'O sistema está ocupado gravando outra alteração. Tente de novo em instantes.';

export const BATIMENTO_MS = 10000;  // renovação do aluguel enquanto a ação roda (1/3 do TTL)

const esperaReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// agenda uma repetição e devolve a função que a cancela (setInterval existe no Node e no Deno); injetável (deps.agendar) nos testes
const agendaReal = (fn, ms) => { const id = setInterval(fn, ms); return () => clearInterval(id); };

// A espera é contada pela soma dos ms pedidos a deps.esperar (não pelo relógio): nos testes, um esperar falso torna tudo
// determinístico e instantâneo. O dono é único por chamada (deps.gerarDono, senão deps.gerarId, senão UUID); um erro do
// próprio pegarTrava (ex.: função inexistente porque o SQL do ajuste 5 não foi rodado) sobe: nunca segue "sem trava".
// Batimento: enquanto a ação roda, o aluguel é renovado a cada ~10 s (mesmo dono), então uma ação lenta não perde a exclusão
// depois dos 30 s. Se a renovação falhar ou disser que a trava foi perdida, só avisa (deps.avisar): a ação termina, nunca é abortada no meio.
export async function comTrava(deps, nome, fn) {
  const gerar = deps.gerarDono || deps.gerarId || (() => globalThis.crypto.randomUUID());
  const esperar = deps.esperar || esperaReal;
  const agendar = deps.agendar || agendaReal;
  const avisar = (m) => { try { if (typeof deps.avisar === 'function') deps.avisar(m); } catch { /* nada */ } };
  const dono = String(gerar());
  let esperado = 0;
  while (!(await deps.repo.pegarTrava(nome, dono, TTL_SEG))) {
    if (esperado >= LIMITE_MS) return { error: MSG_OCUPADO };
    await esperar(INTERVALO_MS);
    esperado += INTERVALO_MS;
  }
  let encerrado = false;
  let renovando = null;
  const renovar = () => {
    if (encerrado || renovando) return;
    renovando = (async () => {
      try {
        if (!(await deps.repo.pegarTrava(nome, dono, TTL_SEG))) avisar('trava "' + nome + '" perdida durante a ação (aluguel tomado por outro); a ação continua');
      } catch (e) { avisar('falha ao renovar a trava "' + nome + '": ' + (e && e.message ? e.message : e)); }
      renovando = null;
    })();
  };
  const parar = agendar(renovar, BATIMENTO_MS);
  try {
    return await fn();
  } finally {
    encerrado = true; // depois disto nenhuma renovação nova começa (uma renovação tardia recriaria a trava já solta)
    parar();
    if (renovando) await renovando;
    try { await deps.repo.soltarTrava(nome, dono); } catch (e) { avisar('falha ao soltar a trava "' + nome + '": ' + (e && e.message ? e.message : e)); }
  }
}
