import assert from 'node:assert/strict';
import { t, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import {
  mapearJogadores, mapearRodadas, mapearConfig, mapearCheckins,
  mapearPerfisPublicos, mapearAoVivo, mapearFinanceiro, CHECKIN_MENSAGEM_PADRAO
} from '../../backend/mapeadores.js';

t('jogadores: sem convidados, na ordem da planilha, textos vazios e estrelas numéricas', () => {
  assert.deepEqual(mapearJogadores(fixture.jogadores), [
    { id: 'p1', nome: 'Ana', apelido: '', foto: '', estrelas: 4, sexo: 'F', porte: 'P' },
    { id: 'p2', nome: 'Bruno', apelido: 'Bru', foto: 'https://exemplo.com/b.jpg', estrelas: 3.5, sexo: 'M', porte: 'G' }
  ]);
});

t('rodadas: ordem por "ordem", times por time_index, jogadores por posicao (com convidado), empate = 2 vencedores', () => {
  const r = mapearRodadas(fixture.rodadas, fixture.times_rodada, fixture.time_jogadores);
  assert.deepEqual(r, [
    { id: 'r1', data: '2026-09-01', rascunho: false, vencedores: [0, 1], times: [
      { nome: 'Time 1', playerIds: ['p1', 'p2'], vitorias: 2 },
      { nome: 'Time 2', playerIds: ['convidado:LUCAS#ab12'], vitorias: 2 } ] },
    { id: 'r2', data: '2026-09-08', rascunho: false, vencedores: [0], times: [
      { nome: 'Time 1', playerIds: ['p1'], vitorias: 3 },
      { nome: 'Time 2', playerIds: ['p2'], vitorias: 1 } ] }
  ]);
});

t('config: valores lidos e padrões para as chaves que faltam', () => {
  assert.deepEqual(mapearConfig(fixture.config), {
    estrelasVisiveis: true, checkinDataAberta: '2026-09-22', checkinTravado: true, checkinVagas: 12,
    checkinHorario: '20:00', checkinMensagemTemplate: CHECKIN_MENSAGEM_PADRAO, contadorAcessos: 41
  });
  assert.equal(mapearConfig([]).checkinVagas, 16);
  assert.equal(mapearConfig([{ chave: 'estrelasVisiveis', valor: 'FALSE' }]).estrelasVisiveis, false);
});

t('checkins: ordem de chegada, órfão vira jogadorId vazio, nota do dia como texto', () => {
  assert.deepEqual(mapearCheckins(fixture.checkins), [
    { id: 'c1', data: '2026-09-22', jogadorId: 'p1', jogadorNome: 'Ana', estrelas: 4, sexo: 'F', estrelasAjustadas: '' },
    { id: 'c2', data: '2026-09-22', jogadorId: 'p2', jogadorNome: 'Bruno', estrelas: 3.5, sexo: 'M', estrelasAjustadas: '4' },
    { id: 'c3', data: '2026-09-22', jogadorId: '', jogadorNome: 'Antigo', estrelas: 0, sexo: 'M', estrelasAjustadas: '' }
  ]);
});

t('perfisPublicos: só quem tem jogador vinculado, na ordem, sem e-mail', () => {
  assert.deepEqual(mapearPerfisPublicos(fixture.usuarios), [
    { jogadorId: 'p1', perfil: 'admin' },
    { jogadorId: 'p2', perfil: 'organizador' }
  ]);
});

t('aoVivo: sem transmissão devolve vazio; com linhas falha alto (etapa 5)', () => {
  assert.deepEqual(mapearAoVivo([], []), { rounds: [], log: [] });
  assert.throws(() => mapearAoVivo([{ round_id: 'r1' }], []), /etapa 5/);
});

t('financeiro: dias, pagamentos, créditos e lançamentos na ordem, com padrões e carimbos ISO', () => {
  const f = mapearFinanceiro(fixture);
  assert.deepEqual(f.dias, [
    { data: '2026-09-15', valorPessoa: 14, pix: '', valorQuadra: 0, temBrinde: false, valorBrinde: 0, icone: '✅', status: 'semjogo' },
    { data: '2026-09-22', valorPessoa: 14, pix: '31999999999', valorQuadra: 180, temBrinde: true, valorBrinde: 50, icone: '💰', status: '' }
  ]);
  assert.deepEqual(f.pagamentos.map((p) => p.id), ['pg1', 'pg2', 'pg3']);
  assert.deepEqual(f.pagamentos[1], {
    id: 'pg2', data: '2026-09-22', jogadorId: 'p2', jogadorNome: 'Bruno', valor: 14, marcadoPor: 'Org',
    marcadoEm: '2026-09-22T19:05:00.000Z', estornado: true, estornadoPor: 'Adm', estornadoEm: '2026-09-22T20:00:00.000Z',
    tipo: 'credito', creditoId: 'cr1'
  });
  assert.equal(f.pagamentos[2].jogadorId, '');
  assert.equal(f.pagamentos[0].estornadoEm, '');
  assert.deepEqual(f.creditos, [{
    id: 'cr1', jogadorId: 'p2', jogadorNome: 'Bruno', valor: 14, origemPagamentoId: 'pg0', dataOrigem: '2026-09-15',
    criadoPor: 'Adm', criadoEm: '2026-09-15T21:00:00.000Z', status: 'ativo', encerradoPor: '', encerradoEm: ''
  }]);
  assert.equal(f.lancamentos[0].valor, 500);
});

t('financeiro.log: mais recente primeiro, sem e-mail, detalhe como texto, no máximo 100', () => {
  const f = mapearFinanceiro(fixture);
  assert.deepEqual(f.log.map((l) => l.acao), ['nota', 'marcarPagamento', 'marcarPagamento']);
  assert.deepEqual(f.log[0], { timestamp: '2026-09-22T20:00:00.000Z', nome: 'Adm', acao: 'nota', detalhe: 'texto solto' });
  assert.equal(f.log[1].detalhe, '{"data":"2026-09-22","jogadorNome":"Bruno","valor":14}');
  const muitos = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, timestamp: '2026-09-22T10:00:00+00:00', nome: 'x', email: 'x', acao: 'a', detalhe: null }));
  const f2 = mapearFinanceiro({ ...fixture, fin_log: muitos });
  assert.equal(f2.log.length, 100);
  assert.equal(f2.log[0].detalhe, '');
});

fim();
