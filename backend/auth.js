// Verificação do login do Google e comparação de segredo. Só usa o `fetch` global (Node e Deno).
// Fonte: verificarTokenGoogle_ de apps-script-codigo.gs — mesmas checagens, na mesma ordem, mesmas mensagens.

// compara sem parar no primeiro caractere diferente (não vaza, pelo tempo, quantos caracteres batem)
export function iguaisSeguros(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  let diferenca = x.length ^ y.length;
  const tamanho = Math.max(x.length, y.length);
  for (let i = 0; i < tamanho; i++) diferenca |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diferenca === 0;
}

export function criarVerificadorGoogle({ clientId, buscar = (...args) => fetch(...args), agora = () => Date.now() }) {
  return async function verificarToken(idToken) {
    if (!idToken) return { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' };

    let resposta;
    try {
      resposta = await buscar('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
    } catch (e) {
      return { ok: false, erro: 'Não foi possível falar com o Google pra conferir seu login. Tente de novo.' };
    }
    if (resposta.status !== 200) return { ok: false, erro: 'Login do Google inválido ou expirado. Entre de novo.' };

    let info;
    try {
      info = await resposta.json();
    } catch (e) {
      return { ok: false, erro: 'Resposta inesperada do Google ao conferir o login.' };
    }

    // "aud" = pra qual aplicativo o token foi emitido; sem essa conferência, um token de QUALQUER outro site valeria aqui
    if (String(info.aud) !== String(clientId)) return { ok: false, erro: 'Login do Google emitido para outro aplicativo.' };
    if (String(info.email_verified) !== 'true') return { ok: false, erro: 'O e-mail dessa conta Google não está verificado.' };
    if (!info.exp || Number(info.exp) * 1000 < agora()) return { ok: false, erro: 'Login do Google expirou. Entre de novo.' };
    if (!info.email) return { ok: false, erro: 'Login do Google não trouxe e-mail. Entre de novo.' };

    return { ok: true, email: String(info.email).trim().toLowerCase(), nome: String(info.name || ''), foto: String(info.picture || '') };
  };
}
