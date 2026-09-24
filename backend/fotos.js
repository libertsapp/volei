// Envio de foto de jogador (port de uploadPhoto do .gs, trocando o Google Drive pelo Supabase Storage).
// Módulo puro: sem node:*, process, require ou Buffer, para rodar igual no Node e na Edge Function (Deno).
// O armazenamento entra por injeção (deps.armazenamento = { enviar, apagar }), como o repositório.
import { mapearJogadores, texto } from './mapeadores.js';

const LIMITE_BYTES = 300 * 1024;
// só nomes que NÓS geramos; barra, ponto-ponto e ids antigos do Drive (maiúsculas, "_") não passam
const CAMINHO_VALIDO = /^[0-9a-z-]+\.jpg$/;

// o Drive não confere o conteúdo, mas o bucket é PÚBLICO: só JPEG de verdade (magic bytes), não o mimeType que o cliente diz
const ehJpeg = (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

function decodificar(base64) {
  if (typeof base64 !== 'string' || !base64) return null;
  // recusa antes de decodificar: evita alocar megabytes só para dizer "grande demais"
  if (base64.length > Math.ceil(LIMITE_BYTES / 3) * 4 + 4) return 'grande';
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1) return null;
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch { return null; }
}

// nome único: carimbo + 8 caracteres aleatórios (criptográficos, nunca Math.random)
function novoCaminho(agora) {
  const rnd = crypto.getRandomValues(new Uint8Array(4));
  const hex = Array.from(rnd, (n) => n.toString(16).padStart(2, '0')).join('');
  return agora.getTime() + '-' + hex + '.jpg';
}

const idDaUrl = (foto) => { const m = /[?&]id=([^&]+)/.exec(texto(foto)); return m ? m[1] : ''; };

// Jogador com login só apaga a foto que é do próprio jogador vinculado (o .gs deixava qualquer um apagar qualquer
// arquivo da pasta pelo id). Organizador, admin e chave mestra apagam qualquer caminho bem formado.
async function podeApagar({ repo }, auth, caminho) {
  if (auth.viaChaveMestra || auth.perfil !== 'jogador') return true;
  if (!auth.jogadorId) return false;
  const dono = mapearJogadores(await repo.lerJogadores()).find((p) => String(p.id) === String(auth.jogadorId));
  return !!dono && idDaUrl(dono.foto) === caminho;
}

async function limparAntiga(deps, auth, antigo) {
  try {
    const caminho = texto(antigo);
    if (!CAMINHO_VALIDO.test(caminho)) return;
    if (!(await podeApagar(deps, auth, caminho))) return;
    await deps.armazenamento.apagar(caminho);
  } catch { /* limpeza nunca derruba o envio, como no .gs */ }
}

export async function uploadPhoto(deps, auth, body) {
  if (!deps.armazenamento) return { error: 'Envio de fotos não configurado neste servidor.' };
  const b = body || {};
  const bytes = decodificar(b.base64);
  if (bytes === 'grande') return { error: 'Foto grande demais (máximo 300 KB).' };
  if (!bytes) return { error: 'Foto inválida: o conteúdo não está em base64.' };
  if (bytes.length === 0) return { error: 'Foto vazia.' };
  if (bytes.length > LIMITE_BYTES) return { error: 'Foto grande demais (máximo 300 KB).' };
  if (!ehJpeg(bytes)) return { error: 'A foto precisa ser uma imagem JPEG.' };

  const caminho = novoCaminho(deps.relogio());
  const url = await deps.armazenamento.enviar(caminho, bytes, 'image/jpeg');
  await limparAntiga(deps, auth, b.fileIdAntigo);
  return { url, fileId: caminho };
}
