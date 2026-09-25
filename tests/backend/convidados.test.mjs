import assert from 'node:assert/strict';
import { t, fim } from './executor.mjs';
import { nomeDoConvidado, coletarConvidados } from '../../backend/convidados.js';

t('nomeDoConvidado: pega o nome entre "convidado:" e o "#" final; outros ids dão null', () => {
  assert.equal(nomeDoConvidado('convidado:CAUA#0z6z'), 'CAUA');
  assert.equal(nomeDoConvidado('convidado:VITOR SANTOS#ham8'), 'VITOR SANTOS');
  assert.equal(nomeDoConvidado('convidado:ALLEF (faltou)#ch69'), 'ALLEF (faltou)');
  assert.equal(nomeDoConvidado('p1'), null);
  assert.equal(nomeDoConvidado(''), null);
  assert.equal(nomeDoConvidado(null), null);
});

t('coletarConvidados: só convidados, sem repetir, com nome', () => {
  assert.deepEqual(coletarConvidados(['p1', 'convidado:CAUA#0z6z', '', 'convidado:CAUA#0z6z', 'convidado:IZA#s7k2', null]), [
    { id: 'convidado:CAUA#0z6z', nome: 'CAUA' },
    { id: 'convidado:IZA#s7k2', nome: 'IZA' }
  ]);
  assert.deepEqual(coletarConvidados([]), []);
});

fim();
