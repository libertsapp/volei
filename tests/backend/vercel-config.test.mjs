// Configuração do Vercel: além do Terça na raiz, os grupos independentes precisam que QUALQUER caminho
// (volei.memberstars.com/<apelido>/...) entregue o mesmo index.html e que /<apelido>/sw.js entregue o sw.js
// (um Service Worker e um app instalado por grupo). Arquivos que existem de verdade continuam tendo prioridade.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { t, fim } from './executor.mjs';

const cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'vercel.json'), 'utf8'));

t('build continua montando só o app do Terça (index.html) e o sw.js', () => {
  assert.equal(cfg.buildCommand, 'rm -rf publicar && mkdir publicar && cp volei-dashboard.html publicar/index.html && cp sw.js publicar/sw.js');
  assert.equal(cfg.outputDirectory, 'publicar');
});

t('rewrites: /<apelido>/sw.js → /sw.js ANTES do "qualquer caminho" → /index.html', () => {
  assert.deepEqual(cfg.rewrites, [
    { source: '/:apelido/sw.js', destination: '/sw.js' },
    { source: '/(.*)', destination: '/index.html' }
  ]);
});

fim();
