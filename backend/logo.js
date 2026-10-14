// Logo do grupo (v18.3). Só ADMIN (matriz de permissões). A imagem vai pro MESMO armazenamento das fotos dos
// jogadores, com nome "logo-<carimbo>-<aleatório>.jpg", e o endereço fica nas configurações: logoUrl (o que o app
// mostra) e logoArquivo (o caminho no armazenamento, para apagar o antigo ao trocar ou ao voltar ao padrão).
// Módulo puro como fotos.js: roda igual no Node e na Edge Function. Nos grupos independentes o repositório e o
// armazenamento já chegam presos ao grupo (cliente-do-grupo / armazenamento-grupo), então cada grupo tem o seu logo.
import { texto } from './mapeadores.js';
import { LIMITE_BYTES, CAMINHO_VALIDO, ehJpeg, decodificar, novoCaminho } from './fotos.js';

async function apagarAntigo(deps, caminho) {
  try {
    // só apaga nome que NÓS geramos (o valor vem do banco, mas não custa desconfiar)
    if (CAMINHO_VALIDO.test(caminho) && caminho.startsWith('logo-')) await deps.armazenamento.apagar(caminho);
  } catch { /* limpeza nunca derruba a troca do logo */ }
}

export async function salvarLogo(deps, body) {
  if (!deps.armazenamento) return { error: 'Envio de imagens não configurado neste servidor.' };
  const b = body || {};
  const antigo = texto((await deps.repo.lerConfig()).find((c) => c.chave === 'logoArquivo')?.valor);

  if (b.remover) {
    await deps.repo.gravarConfig([{ chave: 'logoUrl', valor: '' }, { chave: 'logoArquivo', valor: '' }]);
    await apagarAntigo(deps, antigo);
    return { status: 'ok', logoUrl: '' };
  }

  const bytes = decodificar(b.base64);
  if (bytes === 'grande') return { error: 'Imagem grande demais (máximo 300 KB).' };
  if (!bytes) return { error: 'Imagem inválida: o conteúdo não está em base64.' };
  if (bytes.length === 0) return { error: 'Imagem vazia.' };
  if (bytes.length > LIMITE_BYTES) return { error: 'Imagem grande demais (máximo 300 KB).' };
  if (!ehJpeg(bytes)) return { error: 'O logo precisa ser uma imagem JPEG.' };

  const caminho = 'logo-' + novoCaminho(deps.relogio());
  const url = await deps.armazenamento.enviar(caminho, bytes, 'image/jpeg');
  await deps.repo.gravarConfig([{ chave: 'logoUrl', valor: url }, { chave: 'logoArquivo', valor: caminho }]);
  if (antigo !== caminho) await apagarAntigo(deps, antigo);
  return { status: 'ok', logoUrl: url };
}
