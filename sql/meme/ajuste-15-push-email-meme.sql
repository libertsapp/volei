-- Ajuste 15 do Meme: inscrição de push ligada à conta (v18.7), igual ao ajuste 15 do Terça, no schema "meme".
-- Com o e-mail da conta logada no aparelho, o backend manda o aviso PESSOAL "Você entrou na lista!". Pode rodar mais
-- de uma vez. Se a meme-api nova for publicada antes deste SQL, nada quebra (a inscrição é gravada sem o e-mail).
alter table meme.push_inscricoes add column if not exists email text null;
