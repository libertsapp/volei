-- Ajuste 4 (etapa 4a, financeiro parte 1): trava contra pagamento duplicado.
-- Pode ser executado mais de uma vez sem estragar nada.
-- QUEM RODA: o usuário, no SQL Editor do Supabase (o código não roda SQL de estrutura).
--
-- O .gs segurava um LockService em toda gravação, então dois toques seguidos em "pagou" nunca geravam duas linhas.
-- Aqui não há lock: este índice é a trava. Vale UM pagamento válido (não estornado) por jogador e por dia; o estornado
-- sai do índice, então marcar de novo depois de estornar continua funcionando. O backend trata a violação como "já pago"
-- (mesmo resultado do .gs quando o jogador já estava pago).
--
-- Efeito colateral aceito: se o mesmo jogador tiver DOIS check-ins no mesmo dia (o app não impede no .gs), o "Confirmar
-- todos" do .gs cobrava duas vezes dele; com o índice cobra uma vez.
--
-- Antes de criar, confere se já existe duplicado nos dados migrados (o .gs nunca deveria ter gerado, mas o índice falharia
-- se houvesse). Se aparecer o erro abaixo, rode a consulta que ele mostra, estorne o excedente (não remova a linha: perde o histórico) e rode este arquivo de novo.
do $$
declare
  duplicados int;
begin
  select count(*) into duplicados from (
    select 1 from fin_pagamentos
    where not estornado and jogador_id is not null
    group by data, jogador_id having count(*) > 1
  ) d;
  if duplicados > 0 then
    raise exception 'Há % par(es) data+jogador com mais de um pagamento válido em fin_pagamentos. Consulte: select data, jogador_id, count(*) from fin_pagamentos where not estornado and jogador_id is not null group by 1, 2 having count(*) > 1;', duplicados;
  end if;
end $$;

-- linhas sem jogador (check-in antigo sem cadastro) ficam de fora: jogador_id nulo nunca conflita
create unique index if not exists fin_pagamentos_valido_uniq
  on fin_pagamentos (data, jogador_id)
  where not estornado;
