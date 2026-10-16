// Notificações push (ajuste 11): quem instalou o app como PWA e aceitou a permissão do navegador recebe avisos
// mesmo com o app fechado. NÃO depende de login (igual ao check-in): qualquer aparelho inscrito recebe.
// O envio de verdade (assinar com a chave VAPID e falar com o serviço push do navegador) é injetado em
// deps.enviarPush — isso mantém este arquivo testável sem precisar de rede nem criptografia real nos testes.
// deps.enviarPush(inscricao, payloadTexto) -> deve devolver { ok: true } ou lançar um erro com `.statusCode`
// (404/410 = inscrição morta, removida daqui; outros erros não removem, só não contam como enviado).
const agora = (deps) => deps.relogio().toISOString();
const gerarId = (deps) => (deps.gerarId ? deps.gerarId() : globalThis.crypto.randomUUID());

// email (v18.7): a conta logada no aparelho na hora da inscrição — é o que permite o aviso PESSOAL ("você entrou na
// lista"). Vazio = aparelho sem login (continua recebendo os avisos de todo mundo). Sempre gravado, inclusive vazio:
// quem sai da conta reenvia a inscrição sem login e o aparelho para de receber o aviso pessoal daquela conta.
export async function inscreverPush(deps, sub, email = '') {
  const { repo } = deps;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return { error: 'Inscrição inválida.' };
  }
  await repo.gravarPushInscricao({
    id: gerarId(deps), endpoint: String(sub.endpoint), p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth),
    criado_em: agora(deps), email: String(email || '').toLowerCase() || null
  });
  return { status: 'ok' };
}

export async function removerInscricaoPush(deps, endpoint) {
  if (!endpoint) return { error: 'Endpoint inválido.' };
  await deps.repo.removerPushInscricao(String(endpoint));
  return { status: 'ok' };
}

// manda o mesmo payload pra uma lista de inscrições, em paralelo (abrir o check-in avisa dezenas de aparelhos e
// o organizador fica esperando a resposta). Inscrição que o serviço push diz que morreu (404/410 — desinstalou,
// limpou dados do navegador etc.) é removida sozinha, sem precisar de ação manual.
async function enviarParaInscricoes(deps, inscricoes, payload) {
  const resultados = await Promise.all(inscricoes.map(async (insc) => {
    try {
      await deps.enviarPush(insc, payload);
      return 'enviado';
    } catch (erro) {
      const status = erro && erro.statusCode;
      if (status !== 404 && status !== 410) return 'falhou';
      try { await deps.repo.removerPushInscricao(insc.endpoint); } catch { /* fica pra próxima */ }
      return 'removida';
    }
  }));
  const conta = (r) => resultados.filter((x) => x === r).length;
  return { enviados: conta('enviado'), removidas: conta('removida'), falharam: conta('falhou') };
}

function montarPayload(msg) {
  const titulo = String((msg && msg.titulo) || '').trim().slice(0, 80);
  const corpo = String((msg && msg.corpo) || '').trim().slice(0, 200);
  return titulo ? { titulo, payload: JSON.stringify({ titulo, corpo }) } : null;
}

// envia pra todos os aparelhos inscritos
export async function enviarNotificacao(deps, msg, auth) {
  const m = montarPayload(msg);
  if (!m) return { error: 'Escreva um título para a notificação.' };
  const inscricoes = await deps.repo.lerPushInscricoes();
  return { status: 'ok', ...(await enviarParaInscricoes(deps, inscricoes, m.payload)) };
}

// aviso pessoal (v18.7): só para os aparelhos em que a CONTA de cada jogador está logada. O jogador chega à conta
// pelo vínculo APROVADO (usuarios.jogador_id) — pedido pendente não conta, senão um estranho que pediu o vínculo
// receberia o aviso do outro. Jogador sem conta, ou conta sem aparelho inscrito, simplesmente não recebe.
export async function enviarParaJogadores(deps, jogadorIds, msg) {
  const m = montarPayload(msg);
  const ids = new Set((jogadorIds || []).map(String).filter(Boolean));
  if (!m || ids.size === 0) return { enviados: 0, removidas: 0, falharam: 0 };
  const emails = new Set((await deps.repo.lerUsuarios())
    .filter((u) => u.jogador_id && ids.has(String(u.jogador_id)))
    .map((u) => String(u.email || '').toLowerCase()));
  const inscricoes = (await deps.repo.lerPushInscricoes()).filter((i) => i.email && emails.has(String(i.email).toLowerCase()));
  return enviarParaInscricoes(deps, inscricoes, m.payload);
}
