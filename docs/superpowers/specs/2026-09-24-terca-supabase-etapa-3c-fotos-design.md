# Etapa 3c: fotos (uploadPhoto) no backend Supabase do Terça

## Objetivo

A ação `uploadPhoto` funciona no backend novo com o mesmo contrato de pedido e resposta que o front já usa
(`{action:'uploadPhoto', filename, mimeType, base64, fileIdAntigo, senha, idToken}` -> `{url, fileId}`), guardando
a imagem no bucket público `fotos` do Supabase Storage em vez do Google Drive. **Nenhuma mudança no HTML.**

## Escopo

- `backend/fotos.js` (módulo puro): `uploadPhoto(deps, auth, body)`.
- `backend/armazenamento-supabase.js` e `backend/armazenamento-memoria.js`: o armazenamento entra por injeção
  (`deps.armazenamento = { enviar, apagar }`), como o repositório.
- Handler: `uploadPhoto` fica depois do porteiro (`autorizar`) e fora de qualquer trava, como no `.gs`.
- Scripts: `npm run criar-bucket-fotos` e `npm run migrar-fotos` (simulação por padrão; `-- --aplicar` grava).
- Testes: `fotos.test.mjs`, `handler-etapa3c.test.mjs` e `integracao-etapa3c.mjs` (banco real, manual).

## Decisões

1. **URL compatível com o front:** `<SUPABASE_URL>/storage/v1/object/public/fotos/<caminho>?id=<caminho>`. O Storage
   ignora a query string; a regex `[?&]id=([^&]+)` do `extrairFileIdDaFoto` devolve `<caminho>` como `fileIdAntigo`
   no próximo envio. `fileId` da resposta = `<caminho>`.
2. **Validação (o bucket é público):** base64 válido; no máximo 300 KB decodificados; JPEG pelos bytes mágicos
   `FF D8 FF` (o `mimeType` do cliente é ignorado); arquivo vazio recusado. O bucket repete o limite
   (`fileSizeLimit` 300 KB, só `image/jpeg`).
3. **Nome:** `<carimbo>-<8 hex aleatórios>.jpg`, aleatório via `crypto.getRandomValues` (nunca `Math.random`).
   Nome único permite cache de 1 ano e `upsert:false`.
4. **Apagar a foto antiga:** melhor esforço, nunca falha o envio. Só age se `fileIdAntigo` casar com
   `^[0-9a-z-]+\.jpg$` (ids antigos do Drive e truques como `../x` ou `a/b.jpg` são ignorados em silêncio).

## Endurecimento em relação ao .gs

No `.gs` qualquer usuário autorizado mandava para a lixeira qualquer arquivo da pasta sabendo o id. Aqui, quando
quem chama é o perfil `jogador` (login, não chave mestra), só se apaga o arquivo que é a foto do **próprio jogador
vinculado (aprovado)**. Organizador, admin e chave mestra apagam qualquer caminho bem formado. Ler
`jogadorId` não exigiu mudar o porteiro: `autorizar` já o devolve.

Reforços adicionais:

- `jogador` com login e **sem vínculo aprovado** não envia foto (`Vincule sua conta a um jogador antes de enviar foto.`);
  o front só envia como jogador pelo Meu Perfil, com jogador vinculado.
- Como `updatePlayer` deixa o jogador apontar a própria `foto` para qualquer URL, o `jogador` só apaga o caminho
  se **nenhuma outra linha** de `jogadores` (inclusive convidados e removidos) o referencia; fecha o ataque em dois
  passos (apontar a foto para a URL de outro e depois enviar com `fileIdAntigo` igual).

## Diferenças aceitas

- A foto antiga é apagada **no momento do envio**, antes de o `updatePlayer` gravar a nova URL (ordem herdada do
  front). Sem lixeira do Drive isso agora é definitivo; a recuperação é reenviar a foto.

- Os originais do Drive **não** vão mais para a lixeira; `fileIdAntigo` com id do Drive é ignorado.
- Sem teste diferencial contra o `.gs`: ele usa `DriveApp`, que não dá para simular fielmente. A paridade é do
  contrato (`{url, fileId}`), coberta pelos testes do handler.
- A URL deixa de ser `drive.google.com/thumbnail`; a imagem já é gravada no tamanho final (até 500 px).

## Migração das fotos atuais e virada

`npm run migrar-fotos` (simulação) e `npm run migrar-fotos -- --aplicar`: para cada jogador com foto do Drive,
baixa o **original** de `drive.google.com/uc?export=download`, confere JPEG e 300 KB (senão pula e reporta, sem
reprocessar), envia ao bucket e atualiza `jogadores.foto`. Idempotente (quem já aponta para o nosso Storage é
pulado) e segue depois de falhas individuais.

**Atenção na virada (etapa 6):** uma nova migração completa dos dados a partir da planilha **reinicia
`jogadores.foto` com as URLs do Drive**. Depois dela, rode de novo `npm run migrar-fotos -- --aplicar`.
Ordem de preparo: `npm run criar-bucket-fotos` antes de qualquer envio ou migração.
