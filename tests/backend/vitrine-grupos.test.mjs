import assert from 'node:assert/strict';
import { t, ta, fim } from './executor.mjs';
import { dataLimite, montarVitrine, criarLeitorVitrine } from '../../backend/vitrine-grupos.js';

// Cliente falso do supabase-js com tabelas em memória: aplica eq/gte/in de verdade e anota cada consulta.
function clienteMemoria(tabelas, { falhar } = {}) {
  const consultas = [];
  return {
    consultas,
    from(tabela) {
      const filtros = [];
      let limite = Infinity;
      const q = {
        select() { return q; },
        eq(c, v) { filtros.push((r) => r[c] === v); return q; },
        gte(c, v) { filtros.push((r) => String(r[c]) >= v); return q; },
        lte(c, v) { filtros.push((r) => String(r[c]) <= v); return q; },
        in(c, vs) { filtros.push((r) => vs.includes(r[c])); return q; },
        limit(n) { limite = n; return q; },
        then(res, rej) {
          consultas.push({ tabela, limite });
          if (falhar === tabela) return Promise.resolve({ data: null, error: { message: 'caiu' } }).then(res, rej);
          const data = (tabelas[tabela] || []).filter((r) => filtros.every((f) => f(r))).slice(0, limite);
          return Promise.resolve({ data, error: null }).then(res, rej);
        }
      };
      return q;
    }
  };
}

const AGORA = new Date('2026-10-14T15:00:00.000Z');   // 12h em Brasília

t('dataLimite: hoje em Brasília menos 30 dias', () => {
  assert.equal(dataLimite(AGORA), '2026-09-14');
  // 23h do dia 14 em Brasília já é dia 15 em UTC: vale o dia de Brasília
  assert.equal(dataLimite(new Date('2026-10-15T02:00:00.000Z')), '2026-09-14');
});

t('montarVitrine: só ativos, ordem (jogou primeiro, mais novo primeiro), só campos públicos', () => {
  const v = montarVitrine({
    grupos: [
      { id: 'a', apelido: 'quinta', nome: 'Vôlei de Quinta', cidade: 'Belo Horizonte', uf: 'MG', cor_destaque: '#123456', logo_url: null, status: 'ativo', dono_email: 'x@y.com', plano: 'gratis', criado_em: '2026-10-01T10:00:00Z' },
      { id: 'b', apelido: 'sexta', nome: 'Vôlei de Sexta', cidade: 'Contagem', uf: 'MG', cor_destaque: '#654321', logo_url: 'https://lzwmirrjpoqucwlhgkku.supabase.co/storage/v1/object/public/fotos-grupos/b/logo.png', status: 'ativo', dono_email: 'y@y.com', plano: 'gratis', criado_em: '2026-10-05T10:00:00Z' },
      { id: 'c', apelido: 'sus', nome: 'Suspenso', cidade: 'X', uf: 'SP', cor_destaque: '#000000', status: 'suspenso', criado_em: '2026-10-06T10:00:00Z' }
    ],
    legados: [
      { id: 'terca', nome: 'Vôlei de Terça', cidade: 'Santa Luzia', uf: 'MG', cor: '#ffd700', logo_url: null, ativo: true },
      { id: 'meme', nome: 'Vôlei Meme Brasil', cidade: 'Santa Luzia', uf: 'MG', cor: '#b3790a', logo_url: null, ativo: false }
    ],
    jogaram: new Set(['a', 'terca'])
  });
  assert.equal(v.cadastrados, 3);
  assert.equal(v.jogaramNoMes, 2);
  assert.deepEqual(v.grupos.map((g) => g.nome), ['Vôlei de Quinta', 'Vôlei de Terça', 'Vôlei de Sexta']);
  for (const g of v.grupos) assert.deepEqual(Object.keys(g).sort(), ['cidade', 'cor', 'desde', 'jogouNoMes', 'logoUrl', 'nome', 'uf']);
  assert.deepEqual(v.grupos[0], { nome: 'Vôlei de Quinta', cidade: 'Belo Horizonte', uf: 'MG', cor: '#123456', logoUrl: '', desde: '2026-10-01', jogouNoMes: true });
  assert.equal(v.grupos[1].desde, '');
  assert.ok(!JSON.stringify(v).includes('@'), 'nenhum e-mail na resposta');
});

function bancos() {
  const grupos = clienteMemoria({
    grupos: [
      { id: 'g1', nome: 'Quinta', cidade: 'BH', uf: 'MG', cor_destaque: '#111111', logo_url: null, status: 'ativo', criado_em: '2026-10-01T00:00:00Z' },
      { id: 'g2', nome: 'Sexta', cidade: 'BH', uf: 'MG', cor_destaque: '#222222', logo_url: null, status: 'ativo', criado_em: '2026-10-02T00:00:00Z' },
      { id: 'g3', nome: 'Sábado', cidade: 'BH', uf: 'MG', cor_destaque: '#333333', logo_url: null, status: 'ativo', criado_em: '2026-10-03T00:00:00Z' },
      { id: 'g4', nome: 'Domingo', cidade: 'BH', uf: 'MG', cor_destaque: '#444444', logo_url: null, status: 'suspenso', criado_em: '2026-10-04T00:00:00Z' }
    ],
    rodadas: [
      { grupo_id: 'g1', data: '2026-09-15', rascunho: false },   // há 29 dias: conta
      { grupo_id: 'g2', data: '2026-10-12', rascunho: true },    // rascunho: não conta
      { grupo_id: 'g2', data: '2026-09-13', rascunho: false },   // há 31 dias: não conta
      { grupo_id: 'g4', data: '2026-10-10', rascunho: false }    // suspenso: nem entra
    ],
    checkins: [
      { grupo_id: 'g3', data: '2026-10-13' },
      { grupo_id: 'g2', data: '2026-10-20' }   // check-in para o jogo da semana que vem: ainda não jogou
    ]
  });
  const liga = clienteMemoria({ grupos: [
    { id: 'terca', nome: 'Vôlei de Terça', cidade: 'Santa Luzia', uf: 'MG', cor: '#ffd700', logo_url: null, ativo: true },
    { id: 'meme', nome: 'Vôlei Meme Brasil', cidade: 'Santa Luzia', uf: 'MG', cor: '#b3790a', logo_url: null, ativo: true },
    { id: 'quinta', nome: 'Vôlei de Quinta', ativo: true }   // grupo novo também mora na liga: não pode contar duas vezes
  ] });
  const terca = clienteMemoria({ rodadas: [{ data: '2026-10-07', rascunho: false }], checkins: [] });
  const meme = clienteMemoria({ rodadas: [{ data: '2026-08-01', rascunho: false }, { data: '2026-10-21', rascunho: false }], checkins: [{ data: '2026-10-21' }] });   // só jogo futuro
  return { grupos, liga, terca, meme };
}

await ta('leitor: soma grupos novos + Terça + Meme e marca quem jogou nos últimos 30 dias', async () => {
  const b = bancos();
  const ler = criarLeitorVitrine({ clienteGrupos: b.grupos, clienteLiga: b.liga, clientesLegados: { terca: b.terca, meme: b.meme }, relogio: () => AGORA });
  const v = await ler();
  assert.equal(v.cadastrados, 5, 'Quinta, Sexta, Sábado, Terça, Meme');
  assert.equal(v.jogaramNoMes, 3, 'Quinta (rodada há 29 dias), Sábado (check-in), Terça');
  const porNome = Object.fromEntries(v.grupos.map((g) => [g.nome, g.jogouNoMes]));
  assert.deepEqual(porNome, { Quinta: true, Sexta: false, 'Sábado': true, 'Vôlei de Terça': true, 'Vôlei Meme Brasil': false });
  // atividade sempre com limit(1): nunca traz todas as linhas do mês
  for (const c of [...b.grupos.consultas, ...b.terca.consultas, ...b.meme.consultas].filter((x) => x.tabela !== 'grupos')) assert.equal(c.limite, 1);
});

await ta('leitor: erro do banco vira exceção (quem chama decide a mensagem)', async () => {
  const b = bancos();
  const ler = criarLeitorVitrine({ clienteGrupos: clienteMemoria({}, { falhar: 'grupos' }), clienteLiga: b.liga, clientesLegados: { terca: b.terca, meme: b.meme }, relogio: () => AGORA });
  await assert.rejects(ler(), /vitrine grupos: caiu/);
});

fim();
