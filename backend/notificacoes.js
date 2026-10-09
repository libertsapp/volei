// Notificações push (ajuste 11): quem instalou o app como PWA e aceitou a permissão do navegador recebe avisos
// mesmo com o app fechado. NÃO depende de login (igual ao check-in): qualquer aparelho inscrito recebe.
// O envio de verdade (assinar com a chave VAPID e falar com o serviço push do navegador) é injetado em
// deps.enviarPush — isso mantém este arquivo testável sem precisar de rede nem criptografia real nos testes.
// deps.enviarPush(inscricao, payloadTexto) -> deve devolver { ok: true } ou lançar um erro com `.statusCode`
// (404/410 = inscrição morta, removida daqui; outros erros não removem, só não contam como enviado).
const agora = (deps) => deps.relogio().toISOString();
const gerarId = (deps) => (deps.gerarId ? deps.gerarId() : globalThis.crypto.randomUUID());

export async function inscreverPush(deps, sub) {
  const { repo } = deps;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return { error: 'Inscrição inválida.' };
  }
  await repo.gravarPushInscricao({
    id: gerarId(deps), endpoint: String(sub.endpoint), p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth),
    criado_em: agora(deps)
  });
  return { status: 'ok' };
}

export async function removerInscricaoPush(deps, endpoint) {
  if (!endpoint) return { error: 'Endpoint inválido.' };
  await deps.repo.removerPushInscricao(String(endpoint));
  return { status: 'ok' };
}

// envia pra todos os aparelhos inscritos; inscrição que o serviço push diz que morreu (404/410 — desinstalou,
// limpou dados do navegador etc.) é removida sozinha, sem precisar de ação manual
export async function enviarNotificacao(deps, msg, auth) {
  const { repo } = deps;
  const titulo = String((msg && msg.titulo) || '').trim().slice(0, 80);
  const corpo = String((msg && msg.corpo) || '').trim().slice(0, 200);
  if (!titulo) return { error: 'Escreva um título para a notificação.' };
  const inscricoes = await repo.lerPushInscricoes();
  const payload = JSON.stringify({ titulo, corpo });
  let enviados = 0, removidas = 0, falharam = 0;
  for (const insc of inscricoes) {
    try {
      await deps.enviarPush(insc, payload);
      enviados++;
    } catch (erro) {
      const status = erro && erro.statusCode;
      if (status === 404 || status === 410) { await repo.removerPushInscricao(insc.endpoint); removidas++; }
      else falharam++;
    }
  }
  return { status: 'ok', enviados, removidas, falharam };
}
