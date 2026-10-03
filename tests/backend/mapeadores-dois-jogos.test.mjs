import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { mapearCheckins, mapearConfig, mapearFinanceiro } from '../../backend/mapeadores.js';

await ta('mapearCheckins: devolve jogo (1 quando a coluna vem vazia/nula)', () => {
  const r = mapearCheckins([
    { id: 'c1', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 4, sexo: 'F', estrelas_ajustadas: null, jogo: 2, ordem: 1 },
    { id: 'c2', data: '2026-10-06', jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: null, ordem: 2 }
  ]);
  assert.deepEqual(r.map((c) => c.jogo), [2, 1]);
});

await ta('mapearConfig: checkinJogo2 null sem as chaves; objeto completo quando presentes', () => {
  assert.equal(mapearConfig([]).checkinJogo2, null);
  const cfg = mapearConfig([
    { chave: 'checkinJogo2Data', valor: '2026-10-06' }, { chave: 'checkinJogo2Horario', valor: '21:00' },
    { chave: 'checkinJogo2Vagas', valor: '12' }, { chave: 'checkinJogo2Travado', valor: 'TRUE' }
  ]);
  assert.deepEqual(cfg.checkinJogo2, { data: '2026-10-06', horario: '21:00', vagas: 12, travado: true });
});

await ta('mapearFinanceiro: dias[].porJogo, jogos[], pagamentos[].jogo e creditos[].jogoOrigem', () => {
  const f = mapearFinanceiro({
    fin_dias: [{ data: '2026-10-06', valor_pessoa: 15, pix: '', valor_quadra: 300, tem_brinde: false, valor_brinde: 0, icone: '✅', status: 'normal', por_jogo: true, ordem: 1 }],
    fin_jogos: [{ data: '2026-10-06', jogo: 2, valor_pessoa: 15, pix: 'k', valor_quadra: 180, tem_brinde: false, valor_brinde: 0, icone: '✅', status: 'normal', atualizado_por: 'Org', atualizado_em: '' }],
    fin_pagamentos: [{ id: 'p1', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', valor: 15, marcado_por: 'Org', marcado_em: '', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, jogo: 2, ordem: 1 }],
    fin_creditos: [{ id: 'cr1', jogador_id: 'p1', jogador_nome: 'Ana', valor: 15, origem_pagamento_id: 'p0', data_origem: '2026-09-29', criado_por: 'Adm', criado_em: '', status: 'ativo', encerrado_por: null, encerrado_em: null, jogo_origem: 1, ordem: 1 }],
    fin_lancamentos: [], fin_log: []
  });
  assert.equal(f.dias[0].porJogo, true);
  assert.deepEqual(f.jogos, [{ data: '2026-10-06', jogo: 2, valorPessoa: 15, pix: 'k', valorQuadra: 180, temBrinde: false, valorBrinde: 0, icone: '✅', status: '' }]);
  assert.equal(f.pagamentos[0].jogo, 2);
  assert.equal(f.creditos[0].jogoOrigem, 1);
});

await ta('mapearFinanceiro: pagamento/crédito "do dia" (coluna nula) vira jogo/jogoOrigem null, não 1', () => {
  const f = mapearFinanceiro({
    fin_dias: [], fin_jogos: [],
    fin_pagamentos: [{ id: 'p1', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', valor: 15, marcado_por: 'Org', marcado_em: '', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, jogo: null, ordem: 1 }],
    fin_creditos: [], fin_lancamentos: [], fin_log: []
  });
  assert.equal(f.pagamentos[0].jogo, null);
});

fim();
