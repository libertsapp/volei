// Adaptador HTTP da Edge Function (Deno) e também testável no Node: transforma um Request web em chamadas ao handler
// puro (criarHandler) e devolve um Response. Só usa APIs padrão da web (Request, Response, URL, TextDecoder), que existem
// no Node 24 e no Deno; nada de node:*, process, Buffer nem do global Deno. Segredos e cliente do banco entram pelo handler.
//
// Decisões de segurança (spec da etapa 6a):
//  - POST só é aceito com um cabeçalho Origin da lista (o app manda text/plain para evitar preflight, mas o navegador sempre
//    manda Origin em POST entre sites). Isso não protege contra curl (Origin é forjável); quem protege de verdade é o porteiro.
//  - GET continua público (o Apps Script era assim): qualquer cliente lê; só origens da lista recebem Access-Control-Allow-Origin,
//    então página de outro site não consegue ler a resposta pelo navegador.
//  - O corpo é limitado ANTES de virar texto: pelo Content-Length e, se ele não vier ou mentir, contando os bytes do stream.
//  - Nada de stack ou mensagem interna nas respostas 500.
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

// IP do cliente para o limitador de tentativas: SÓ o cf-connecting-ip (o proxy da Cloudflare o sobrescreve; o cliente não consegue
// forjar). x-forwarded-for NÃO é usado: o cliente pode escrever nele e fugiria do bloqueio trocando de "IP". Sem o cabeçalho devolve ''.
export function ipDoCliente(headers) {
  return (headers.get('cf-connecting-ip') || '').trim();
}

// lê o corpo respeitando o limite; devolve null se passou dele (sem guardar mais do que o limite)
async function lerCorpoLimitado(request, limite) {
  if (!request.body) return '';
  const leitor = request.body.getReader();
  const pedacos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) { try { await leitor.cancel(); } catch { /* nada */ } return null; }
    pedacos.push(value);
  }
  const todos = new Uint8Array(total);
  let pos = 0;
  for (const p of pedacos) { todos.set(p, pos); pos += p.byteLength; }
  return new TextDecoder().decode(todos);
}

export function criarEdge({ handler, origensPermitidas = [], limiteCorpoBytes = 600 * 1024, registrar = () => {} }) {
  const permitidas = new Set((origensPermitidas || []).map((o) => String(o).trim().replace(/\/+$/, '')).filter(Boolean));
  const origemOk = (o) => !!o && permitidas.has(o);
  let avisouSemIp = false; // avisa uma vez por instância

  return async function atender(request) {
    const origem = request.headers.get('origin');
    // CORS só para origem da lista; para as outras nenhum cabeçalho (o navegador bloqueia a leitura)
    const cors = origemOk(origem) ? { 'access-control-allow-origin': origem, vary: 'Origin' } : { vary: 'Origin' };
    const responder = (status, objeto, extra = {}) => new Response(JSON.stringify(objeto), { status, headers: { ...JSON_HEADERS, ...cors, ...extra } });

    // sem cf-connecting-ip todos caem num balde único 'desconhecido' (limita, mas um atacante trancaria a chave mestra de todos;
    // o login do Google segue valendo). Avisa uma vez para o operador perceber.
    const ipParaLimitador = (headers) => {
      const ip = ipDoCliente(headers);
      if (ip) return ip;
      if (!avisouSemIp) { avisouSemIp = true; try { registrar(new Error('cf-connecting-ip ausente: limitador usando balde único')); } catch { /* nada */ } }
      return 'desconhecido';
    };

    try {
      if (request.method === 'OPTIONS') {
        if (!origemOk(origem)) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', vary: 'Origin' } });
        return new Response(null, {
          status: 204,
          headers: {
            ...cors, 'cache-control': 'no-store',
            'access-control-allow-methods': 'GET,POST,OPTIONS',
            'access-control-allow-headers': 'Content-Type',
            'access-control-max-age': '86400'
          }
        });
      }

      if (request.method === 'GET') return responder(200, await handler.get());

      if (request.method === 'POST') {
        if (!origemOk(origem)) return responder(403, { error: 'Origem não permitida.' });
        const declarado = Number(request.headers.get('content-length'));
        if (Number.isFinite(declarado) && declarado > limiteCorpoBytes) return responder(413, { error: 'Corpo grande demais.' });
        const texto = await lerCorpoLimitado(request, limiteCorpoBytes);
        if (texto === null) return responder(413, { error: 'Corpo grande demais.' });
        let corpo;
        try { corpo = JSON.parse(texto || '{}'); } catch { return responder(400, { error: 'Corpo inválido.' }); }
        if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) return responder(400, { error: 'Corpo inválido.' });
        return responder(200, await handler.post(corpo, { ip: ipParaLimitador(request.headers) }));
      }

      return responder(405, { error: 'Método não permitido.' }, { allow: 'GET,POST,OPTIONS' });
    } catch (erro) {
      try { registrar(erro); } catch { /* nada */ }
      return responder(500, { error: 'Erro interno no servidor.' });
    }
  };
}
