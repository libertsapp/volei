import assert from 'node:assert/strict';
import { t, fim } from './executor.mjs';
import {
  UFS, PALETA, APELIDOS_RESERVADOS, normalizarApelido, validarApelido, sugerirApelido, normalizarCidade, validarCadastroGrupo,
  motivoDoApelido, MENSAGENS_CADASTRO
} from '../../backend/grupos-cadastro.js';

t('UFs: as 27, únicas', () => {
  assert.equal(UFS.length, 27);
  assert.equal(new Set(UFS).size, 27);
  assert.ok(UFS.includes('MG') && UFS.includes('DF'));
});

t('paleta: hex minúsculo de 6 dígitos, sem repetição, pelo menos 6 cores', () => {
  assert.ok(PALETA.length >= 6);
  assert.equal(new Set(PALETA).size, PALETA.length);
  for (const c of PALETA) assert.match(c, /^#[0-9a-f]{6}$/);
});

t('validarApelido: aceita o formato certo e explica o que está errado', () => {
  for (const ok of ['quinta', 'volei-da-quinta', 'bh2026', 'abc']) assert.equal(validarApelido(ok), '', ok);
  assert.match(validarApelido('ab'), /3 a 30/);
  assert.match(validarApelido('a'.repeat(31)), /3 a 30/);
  for (const ruim of ['Quinta', 'vôlei', 'meu grupo', '-quinta', 'quinta-', 'qu--inta', 'quinta!']) {
    assert.match(validarApelido(ruim), /letras minúsculas/, ruim);
  }
  for (const r of ['criar', 'admin', 'terca', 'meme', 'porra']) assert.match(validarApelido(r), /reservado/, r);
});

t('normalizarApelido e sugerirApelido', () => {
  assert.equal(normalizarApelido('  quinta '), 'quinta');
  assert.equal(sugerirApelido('Vôlei da Quinta!'), 'volei-da-quinta');
  assert.equal(sugerirApelido('  São   João  '), 'sao-joao');
  assert.equal(sugerirApelido('Á'.repeat(40)).length, 30);
  assert.equal(validarApelido(sugerirApelido('Vôlei de Sábado - Praia')), '');
});

t('normalizarCidade: espaços, maiúsculas e preposições', () => {
  assert.equal(normalizarCidade('  são   paulo '), 'São Paulo');
  assert.equal(normalizarCidade('BELO HORIZONTE'), 'Belo Horizonte');
  assert.equal(normalizarCidade('rio de janeiro'), 'Rio de Janeiro');
  assert.equal(normalizarCidade('santana do parnaíba'), 'Santana do Parnaíba');
  assert.equal(normalizarCidade('de'), 'De'); // a primeira palavra sempre maiúscula
});

t('validarCadastroGrupo: devolve os dados normalizados ou o primeiro erro', () => {
  const base = { nome: '  Vôlei de Quinta ', apelido: 'quinta', cidade: 'belo horizonte', uf: 'mg', cor: PALETA[0].toUpperCase() };
  assert.deepEqual(validarCadastroGrupo(base), { dados: { nome: 'Vôlei de Quinta', apelido: 'quinta', cidade: 'Belo Horizonte', uf: 'MG', cor: PALETA[0] } });
  assert.deepEqual(validarCadastroGrupo({ ...base, nome: 'ab' }), { erro: 'O nome do grupo precisa ter de 3 a 60 caracteres.' });
  assert.deepEqual(validarCadastroGrupo({ ...base, cidade: ' ' }), { erro: 'Informe a cidade do grupo.' });
  assert.deepEqual(validarCadastroGrupo({ ...base, uf: 'XX' }), { erro: 'Escolha o estado (UF).' });
  assert.deepEqual(validarCadastroGrupo({ ...base, cor: '#123456' }), { erro: 'Escolha uma das cores da paleta.' });
  assert.match(validarCadastroGrupo({ ...base, apelido: 'admin' }).erro, /reservado/);
});

t('lista de reservados: minúscula e sem repetição', () => {
  assert.equal(new Set(APELIDOS_RESERVADOS).size, APELIDOS_RESERVADOS.length);
  for (const r of APELIDOS_RESERVADOS) assert.equal(r, r.toLowerCase());
});

t('motivoDoApelido: código e mensagem iguais aos do SQL (mesmo texto para a mesma recusa)', () => {
  assert.equal(motivoDoApelido('quinta'), null);
  assert.deepEqual(motivoDoApelido('Qu Inta'), { codigo: 'apelido_invalido', mensagem: MENSAGENS_CADASTRO.apelido_invalido });
  assert.deepEqual(motivoDoApelido('ab'), { codigo: 'apelido_invalido', mensagem: 'O endereço precisa ter de 3 a 30 caracteres.' });
  assert.deepEqual(motivoDoApelido('admin'), { codigo: 'apelido_reservado', mensagem: MENSAGENS_CADASTRO.apelido_reservado });
  assert.equal(validarApelido('admin'), MENSAGENS_CADASTRO.apelido_reservado);
  assert.deepEqual(validarCadastroGrupo({ nome: 'Vôlei', apelido: 'admin', cidade: 'BH', uf: 'MG', cor: PALETA[0] }),
    { erro: MENSAGENS_CADASTRO.apelido_reservado, codigo: 'apelido_reservado' });
  assert.deepEqual(Object.keys(MENSAGENS_CADASTRO).sort(), ['apelido_em_uso', 'apelido_invalido', 'apelido_reservado', 'limite_por_email']);
});

fim();
