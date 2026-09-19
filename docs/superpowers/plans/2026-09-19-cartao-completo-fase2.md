# Cartão do Jogador completo — Fase 2 (estatísticas e destaques) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o cartão completo (variante `lista`) ao Ranking e Top 5 do Início, Hall da Fama, Duplas, Panelas, Defuntos (etapa 2A, v9.1), e ao Top 10 de fotos, ao card de campeões do Início e ao Ao Vivo (etapa 2B, v9.2).

**Architecture:** A função pura `jogadorCardHtml` ganha três opções (`tituloAtributos`, `semAnimacao`, `tela`). Um helper fino `cartaoDaTela(tela, p, ctx, extras, opcoes)` monta o cartão completo de uma tela. O estado "aberto" passa a ser por tela (`"<tela>:<id>"`) com um único listener delegado no `document`. Cada renderer troca só a marcação do jogador; funções inteiras são trocadas por um utilitário de brace-matching e trechos dentro de funções grandes por um script recortado por função.

**Tech Stack:** HTML + CSS + JS puro; container queries; sem biblioteca nova.

**Spec:** `docs/superpowers/specs/2026-09-19-cartao-completo-fase2-design.md`

## Global Constraints

- Só o **Terça** (`volei-dashboard.html`). Nada em `volei-meme-dashboard.html` nem `.gs` sem autorização explícita. Sem mudança de backend.
- Toda mudança em JS passa pela validação de sintaxe (comando exato em cada task).
- Versões do rodapé: `Ver.: 9.0` → `9.1` (fim da Task 3) → `9.2` (fim da Task 5), cada uma com entrada no Log de Alterações (`#info-changelog`).
- Ao Vivo: **nenhuma animação de entrada** dentro de `.aovivo-card` (a tela re-renderiza a cada 9s e a cada clique nos steppers).
- Nada de `backdrop-filter` no cartão; especialmente nada dentro de `.flip-card-*`.
- O toque em **Títulos** no Ranking (abre as datas de campeão) **não pode se perder**.
- Ids da animação do Top 10 (`podium-count-*`, `lb-count-*`, `lb-fill-*`) **preservados**.
- O card 3D do Início não pode ser virado pelo toque num cartão de jogador (só pelo resto do quadro).
- **Fora do escopo:** Histórico, Check-in, Sorteio, Nova Rodada (Fase 1), aba Jogadores (só a migração da chave do estado), Meu Perfil, modal de perfil, dropdown do picker.
- Modo claro legível; nenhuma rolagem horizontal em 390px.
- Comentários em português explicando o *porquê*; nomes de função em português.
- Ambiente Windows: `TMP="C:/Users/Heleno/AppData/Local/Temp/claude"`; `SP="$TMP/c--Users-Heleno-OneDrive-Documentos-GitHub-voleis-VS/18a97619-5c6e-4fd5-843b-2fe350637e40/scratchpad"` (onde está o `puppeteer-core`). O HTML no disco é CRLF (autocrlf): scripts que editam devem preservar CRLF.
- Branch de trabalho: `card-jogador`. Cada task termina com um commit.

## Estrutura de arquivos

- **Modificar apenas:** `volei-dashboard.html`
  - `jogadorCardHtml` (3 pontos), blocos novos após `// </card-dados>`, listener delegado (substitui o de `#player-list`), renderers das 8 telas, CSS no fim do `<style>`, rodapé e `#info-changelog`
- **Fora do repositório:** `TMP/test_card.js` (estendido), `TMP/troca_funcao.js`, `TMP/edita_funcao.js`, scripts de navegador em `SP`.

## Utilitários (criar uma vez, na Task 1)

**`TMP/troca_funcao.js`** — troca uma função inteira (pelo nome) por código de um arquivo, com casamento de chaves que entende strings, comentários e templates. Preserva CRLF. Uso: `node troca_funcao.js <nome> <arquivo> [--remover]`.

```javascript
const fs = require('fs');
const F = 'c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS/volei-dashboard.html';
function fimTemplate(s, i){            // i = logo após a crase de abertura; devolve o índice após a crase de fechamento
  while(i < s.length){
    const c = s[i];
    if(c === '\\'){ i += 2; continue; }
    if(c === '`') return i + 1;
    if(c === '$' && s[i+1] === '{'){ i = fimCorpo(s, i + 1); continue; }
    i++;
  }
  return -1;
}
function fimCorpo(s, i){               // s[i] === '{'; devolve o índice logo após a '}' correspondente
  let prof = 0;
  while(i < s.length){
    const c = s[i], n = s[i+1];
    if(c === '/' && n === '/'){ i = s.indexOf('\n', i); if(i < 0) return -1; continue; }
    if(c === '/' && n === '*'){ i = s.indexOf('*/', i) + 2; continue; }
    if(c === "'" || c === '"'){ const q = c; i++; while(s[i] !== q){ if(s[i] === '\\') i++; i++; } i++; continue; }
    if(c === '`'){ i = fimTemplate(s, i + 1); continue; }
    if(c === '{') prof++;
    if(c === '}'){ prof--; if(prof === 0) return i + 1; }
    i++;
  }
  return -1;
}
const [,, nome, arq, flag] = process.argv;
let h = fs.readFileSync(F, 'utf8');
const crlf = h.includes('\r\n');
const marca = 'function ' + nome + '(';
const ini = h.indexOf(marca);
if(ini < 0 || h.indexOf(marca, ini + 1) >= 0) throw new Error('função não achada ou duplicada: ' + nome);
const corpo = h.indexOf('{', h.indexOf(')', ini));
const fim = fimCorpo(h, corpo);
if(fim < 0) throw new Error('não achei o fim de ' + nome);
let novo = flag === '--remover' ? '' : fs.readFileSync(arq, 'utf8').replace(/\s+$/, '');
if(crlf) novo = novo.replace(/\r?\n/g, '\r\n');
h = h.slice(0, ini) + novo + h.slice(fim);
fs.writeFileSync(F, h);
console.log((flag === '--remover' ? 'removida: ' : 'substituída: ') + nome);
```

**`TMP/edita_funcao.js`** — aplica trocas de texto exato **só dentro de uma função** (o mesmo trecho aparece em várias). Uso: `node edita_funcao.js <nome> <arquivo.json>`, onde o JSON é `[["de","para"], ...]`. Cada `de` precisa aparecer **exatamente uma vez** na função, senão aborta.

```javascript
const fs = require('fs');
const F = 'c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS/volei-dashboard.html';
const [,, nome, arq] = process.argv;
let h = fs.readFileSync(F, 'utf8');
const crlf = h.includes('\r\n');
const fmt = s => crlf ? s.replace(/\r?\n/g, '\r\n') : s;
const ini = h.indexOf('function ' + nome + '(');
if(ini < 0) throw new Error('função não achada: ' + nome);
const fim = h.indexOf('\nfunction ', ini + 10) >= 0 ? h.indexOf('\nfunction ', ini + 10) : h.length;
let corpo = h.slice(ini, fim);
JSON.parse(fs.readFileSync(arq, 'utf8')).forEach(([de, para])=>{
  const d = fmt(de);
  const n = corpo.split(d).length - 1;
  if(n !== 1) throw new Error(nome + ': ' + n + ' ocorrências de: ' + de.slice(0, 90));
  corpo = corpo.replace(d, () => fmt(para));
});
h = h.slice(0, ini) + corpo + h.slice(fim);
fs.writeFileSync(F, h);
console.log('editada: ' + nome);
```

Verificação dos utilitários (Step 1 da Task 1): rodar `node --check` nos dois arquivos.

---

## Task 1: Infraestrutura — opções do componente, helper por tela e estado "aberto" por tela

**Files:**
- Modify: `volei-dashboard.html` — `jogadorCardHtml` (3 pontos), helpers após `// </card-dados>`, listener delegado (substitui o de `#player-list`), `renderPlayers`, CSS
- Create (fora do repo): `TMP/troca_funcao.js`, `TMP/edita_funcao.js`
- Test: `TMP/test_card.js`

**Interfaces:**
- Produces: `opcoes.tituloAtributos: string`, `opcoes.semAnimacao: bool`, `opcoes.tela: string` em `jogadorCardHtml`; `jcChave(tela, id): string`; `jcAberto(tela, id): bool`; `cartaoDaTela(tela, p, ctx, extras?, opcoes?): string`.

- [ ] **Step 1: Criar os dois utilitários**

Salvar os dois blocos da seção "Utilitários" acima como `TMP/troca_funcao.js` e `TMP/edita_funcao.js`, e validar:

```bash
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node --check "$TMP/troca_funcao.js" && node --check "$TMP/edita_funcao.js" && echo "UTILITÁRIOS OK"
```
Expected: `UTILITÁRIOS OK`.

- [ ] **Step 2: Estender o teste (deve falhar)**

Acrescentar ao fim de `TMP/test_card.js`, **antes** de `console.log('OK — cartão do jogador');`:

```javascript
// ===== Fase 2: opções novas =====
const tt = c({}, { variante:'lista', tituloAtributos:'data-ranking-titulos="p1"' });
assert.ok(tt.includes('ranking-titulos-clicavel') && tt.includes('data-ranking-titulos="p1"') && tt.includes('Toque para ver as datas'));
assert.ok(!c({}, { variante:'lista' }).includes('data-ranking-titulos'));
assert.ok(!c({}, { variante:'lista' }).includes('ranking-titulos-clicavel'));           // sem a opção, Títulos não é clicável
const tp = c({}, { variante:'perfil', tituloId:'x1', tituloAtributos:'data-a="1"' });
assert.ok(tp.includes('id="x1"') && !tp.includes('data-a="1"'));                          // perfil com tituloId tem prioridade
assert.ok(c({}, { variante:'lista', semAnimacao:true }).includes('jc-sem-anim'));
assert.ok(!c({}, { variante:'lista' }).includes('jc-sem-anim'));
assert.ok(c({}, { variante:'lista', tela:'ranking' }).includes(' data-jc-tela="ranking"'));
assert.ok(!c({}, { variante:'lista' }).includes('data-jc-tela'));
assert.ok(c({}, { variante:'reduzido', tela:'x', atributos:'draggable="true"' }).includes(' data-jc-tela="x" draggable="true">'));
assert.ok(c({}, { variante:'lista', tela:'a"b' }).includes('data-jc-tela="a&quot;b"'));   // tela escapada
[ { tituloAtributos:'data-t="1"' }, { semAnimacao:true, tela:'aovivo' } ].forEach(op => {
  const h = c({ estrelas:4, posicao:3 }, Object.assign({ variante:'lista' }, op));
  assert.strictEqual(n(h, '<div'), n(h, '</div>'));
});
```

```bash
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/test_card.js" 2>&1 | grep -m1 "AssertionError"
```
Expected: falha (`ranking-titulos-clicavel` ainda não aparece com `tituloAtributos`).

- [ ] **Step 3: Editar `jogadorCardHtml` (3 pontos)**

(a) Títulos — trocar

```javascript
    const titulo = (perfil && op.tituloId)
      ? `<span class="jc-valor ranking-titulos-clicavel" id="${escapeHtml(op.tituloId)}" title="Toque para ver as datas">${m.titulos}</span>`
      : `<span class="jc-valor">${m.titulos}</span>`;
```

por

```javascript
    // Títulos clicável (abre as datas de campeão): no perfil por id; no Ranking por atributos que quem chama monta
    const titulo = (perfil && op.tituloId)
      ? `<span class="jc-valor ranking-titulos-clicavel" id="${escapeHtml(op.tituloId)}" title="Toque para ver as datas">${m.titulos}</span>`
      : (op.tituloAtributos
        ? `<span class="jc-valor ranking-titulos-clicavel" ${op.tituloAtributos} title="Toque para ver as datas">${m.titulos}</span>`
        : `<span class="jc-valor">${m.titulos}</span>`);
```

(b) Classe e atributos — trocar

```javascript
  if(!perfil && !reduzido && op.aberto && d.metricas) classes.push('aberto');
  // "atributos" vem pronto e confiável de quem chama (ids do próprio app: draggable, data-player-id...)
  const atributos = op.atributos ? ' ' + op.atributos : '';
```

por

```javascript
  if(!perfil && !reduzido && op.aberto && d.metricas) classes.push('aberto');
  if(op.semAnimacao) classes.push('jc-sem-anim'); // Ao Vivo: a tela re-renderiza a cada poll, uma animação de entrada faria o cartão piscar
  // "atributos" vem pronto e confiável de quem chama (ids do próprio app: draggable, data-player-id...);
  // "tela" isola o estado aberto/fechado do cartão por tela (ver jcChave)
  const atributos = (op.tela ? ` data-jc-tela="${escapeHtml(op.tela)}"` : '') + (op.atributos ? ' ' + op.atributos : '');
```

- [ ] **Step 4: Helpers e listener delegado**

Logo **depois** da linha `// </card-dados>`, acrescentar:

```javascript
/* ---------- ESTADO "ABERTO" DOS CARTÕES, POR TELA ----------
   A chave é "<tela>:<id>": abrir o Fábio no Ranking não abre o Fábio na aba Jogadores. */
function jcChave(tela, id){ return tela + ':' + id; }
function jcAberto(tela, id){ return JOGADOR_CARD_ABERTOS.has(jcChave(tela, id)); }
// Cartão completo (variante 'lista') de um jogador numa tela: monta os dados e lê o "aberto" daquela tela.
// "extras" sobrescreve campos de dados (ex.: posicao/metricas do ano no Ranking); "opcoes" as opções do cartão.
function cartaoDaTela(tela, p, ctx, extras, opcoes){
  return jogadorCardHtml(
    montarDadosCard(p, ctx, extras),
    Object.assign({ variante: 'lista', tela: tela, aberto: jcAberto(tela, p.id) }, opcoes || {})
  );
}
// Um listener só, no document, vale para TODAS as telas. Só troca uma classe: chamar o render aqui
// reiniciaria a animação de entrada e o cartão "piscaria".
document.addEventListener('click', (e)=>{
  const btn = e.target.closest && e.target.closest('.jc-toggle');
  if(!btn) return;
  const card = btn.closest('.jogador-card');
  if(!card) return;
  const abrir = !card.classList.contains('aberto');
  card.classList.toggle('aberto', abrir);
  btn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  const chave = jcChave(card.dataset.jcTela || 'jogadores', card.dataset.jcId);
  if(abrir) JOGADOR_CARD_ABERTOS.add(chave); else JOGADOR_CARD_ABERTOS.delete(chave);
});
```

Depois, **remover** o listener antigo (logo depois de `renderPlayers`), que é este bloco:

```javascript
// Delegado na lista (um listener só, que sobrevive aos re-renders). Só troca uma classe:
// chamar renderPlayers() aqui reiniciaria a animação de entrada e o cartão "piscaria".
document.getElementById('player-list').addEventListener('click', (e)=>{
  const btn = e.target.closest('.jc-toggle');
  if(!btn) return;
  const card = btn.closest('.jogador-card');
  const abrir = !card.classList.contains('aberto');
  card.classList.toggle('aberto', abrir);
  btn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  if(abrir) JOGADOR_CARD_ABERTOS.add(card.dataset.jcId); else JOGADOR_CARD_ABERTOS.delete(card.dataset.jcId);
});
```

E em `renderPlayers` trocar

```javascript
      { variante: 'lista', aberto: JOGADOR_CARD_ABERTOS.has(p.id) }
```

por

```javascript
      { variante: 'lista', tela: 'jogadores', aberto: jcAberto('jogadores', p.id) }
```

- [ ] **Step 5: CSS**

Inserir imediatamente antes de `</style>`:

```css
  /* ===== FASE 2: cartão completo em outras telas ===== */
  .jc-sem-anim{animation:none !important;}
  .aovivo-card .jc-lista{animation:none;} /* cinto de segurança: nada dentro do Ao Vivo anima de entrada */
  .jc-tag{font-size:11px;color:var(--muted);border:1px solid var(--line);padding:2px 7px;border-radius:10px;}
  .jc-tag-ouro{color:var(--ball-yellow);border-color:color-mix(in srgb, var(--ball-yellow) 45%, transparent);font-weight:700;}
  .jc-tag-alerta{font-size:11px;color:var(--danger);border:1px solid var(--danger);padding:2px 7px;border-radius:10px;font-weight:700;}
  /* colunas de time (Início e Ao Vivo) com cartão completo: 160px não comporta, então alarga */
  .history-teams:has(.jc-lista){grid-template-columns:repeat(auto-fit,minmax(280px,1fr));}
```

- [ ] **Step 6: Testes, sintaxe e regressão da aba Jogadores**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/test_card.js" && node "$TMP/test_card_dados.js"
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.argv[1]+'/check_html.js',m[1]);" "$TMP" && node --check "$TMP/check_html.js" && echo "SINTAXE OK"
grep -c "getElementById('player-list').addEventListener('click'" volei-dashboard.html
```
Expected: `OK — cartão do jogador`, `OK — dados do cartão`, `SINTAXE OK` e `0` (o listener antigo saiu).

Verificação no navegador (`SP/verif_f2_infra.js`, mesma base dos scripts anteriores: `puppeteer-core`, Chrome em `C:/Program Files/Google/Chrome/Application/chrome.exe`, miniaturas do Drive bloqueadas, `http://localhost:8000/volei-dashboard.html`):

```javascript
await page.evaluate(()=>{ document.querySelector('#nav button[data-view="jogadores"]').click(); renderPlayers(); });
const r = await page.evaluate(()=>{
  const cards = [...document.querySelectorAll('#player-list .jogador-card')].filter(c=>c.querySelector('.jc-toggle'));
  const id = cards[0].dataset.jcId;
  cards[0].querySelector('.jc-toggle').click();                       // abre pelo listener delegado
  const abriu = cards[0].classList.contains('aberto');
  const chaveNoSet = JOGADOR_CARD_ABERTOS.has('jogadores:' + id);
  renderPlayers();                                                   // re-render: continua aberto
  const continuaAberto = document.querySelector('#player-list .jogador-card[data-jc-id="' + id + '"]').classList.contains('aberto');
  const telaNoDom = document.querySelector('#player-list .jogador-card').dataset.jcTela;
  document.querySelector('#player-list .jogador-card[data-jc-id="' + id + '"] .jc-toggle').click();   // fecha
  const fechou = !document.querySelector('#player-list .jogador-card[data-jc-id="' + id + '"]').classList.contains('aberto');
  return { abriu, chaveNoSet, continuaAberto, telaNoDom, fechou, semChaveSolta: !JOGADOR_CARD_ABERTOS.has(id) };
});
```
Expected: todos `true`, `telaNoDom === 'jogadores'`; nenhum `pageerror`.

- [ ] **Step 7: Commit**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
git add volei-dashboard.html
git commit -m "$(cat <<'EOF'
Cartão do jogador: opções da Fase 2 e estado aberto/fechado por tela

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 (2A): Ranking e Top 5 do Início

**Files:**
- Modify: `volei-dashboard.html` — `rankingTableHtml` (vira `rankingCartoesHtml`), `wireRankingTitulosClicks`, `renderRanking`, `renderDashboard` (Top 5), CSS

**Interfaces:**
- Consumes: `cartaoDaTela`, `contextoCards` (Task 1). `computeRanking(ano)` → `[{ id, jogos, titulos, vitoriasPartidas, pct, datasCampeao, ... }]` já ordenado.
- Produces: `rankingCartoesHtml(rows): string` (cartões **abertos**, hexágono = índice+1, métricas do ano).

- [ ] **Step 1: Trocar `rankingTableHtml` por `rankingCartoesHtml`**

Salvar como `TMP/ranking_cartoes.js`:

```javascript
/* Ranking em cartões (variante lista, ABERTOS). As métricas são as do ANO escolhido e o hexágono é a posição
   nele — por isso passam por "extras" e não vêm do ctx (que é do ano corrente). "rows" já vem ordenada por
   computeRanking, então o índice é a posição. O toque em Títulos abre as datas (data-ranking-titulos). */
function rankingCartoesHtml(rows){
  const ctx = contextoCards();
  return `<div class="rk-cartoes">${rows.map((r, i)=>{
    const p = getPlayer(r.id);
    if(!p) return '';
    return cartaoDaTela('ranking', p, ctx,
      { posicao: i + 1, metricas: { partidas: r.jogos, titulos: r.titulos, pct: r.pct, vitorias: r.vitoriasPartidas } },
      { aberto: true, tituloAtributos: `data-ranking-titulos="${r.id}"` });
  }).join('')}</div>`;
}
```

```bash
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
node "$TMP/troca_funcao.js" rankingTableHtml "$TMP/ranking_cartoes.js"
```

- [ ] **Step 2: Escopo do clique em Títulos**

Trocar a função inteira `wireRankingTitulosClicks` (hoje varre o `document` inteiro, o que empilha listeners quando o Ranking e o Top 5 do Início existem ao mesmo tempo) por:

```javascript
function wireRankingTitulosClicks(rows, raiz){
  // limitado ao container que acabou de ser renderizado: varrer o document inteiro religava os
  // cartões do outro lugar (Ranking x Top 5 do Início) e o clique abria a janela de datas duas vezes
  (raiz || document).querySelectorAll('[data-ranking-titulos]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const row = rows.find(r=>r.id===el.dataset.rankingTitulos);
      if(!row) return;
      abrirDatasCampeao(row.apelido||row.nome, row.datasCampeao);
    });
  });
}
```

Salvar como `TMP/wire_ranking.js` e:

```bash
node "$TMP/troca_funcao.js" wireRankingTitulosClicks "$TMP/wire_ranking.js"
```

- [ ] **Step 3: Usar nos dois lugares**

Em `renderRanking`, trocar

```javascript
  container.innerHTML = rankingPodioHtml(rows) + rankingTableHtml(rows);
  wireRankingTitulosClicks(rows);
```

por

```javascript
  container.innerHTML = rankingPodioHtml(rows) + rankingCartoesHtml(rows);
  wireRankingTitulosClicks(rows, container);
```

Em `renderDashboard`, trocar

```javascript
    top5container.innerHTML = rankingTableHtml(top5);
    wireRankingTitulosClicks(top5);
```

por

```javascript
    top5container.innerHTML = rankingCartoesHtml(top5);
    wireRankingTitulosClicks(top5, top5container);
```

- [ ] **Step 4: CSS**

Antes de `</style>`:

```css
  .rk-cartoes{display:flex;flex-direction:column;gap:10px;}
```

- [ ] **Step 5: Sintaxe e restos**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/test_card.js" && node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.argv[1]+'/check_html.js',m[1]);" "$TMP" && node --check "$TMP/check_html.js" && echo "SINTAXE OK"
grep -c "rankingTableHtml" volei-dashboard.html
```
Expected: `OK — cartão do jogador`, `SINTAXE OK` e `0` (nenhuma chamada restante a `rankingTableHtml`).

- [ ] **Step 6: Verificação no navegador**

`SP/verif_ranking.js`:

```javascript
await page.evaluate(()=>{ SETTINGS.estrelasVisiveis = true; document.querySelector('#nav button[data-view="ranking"]').click(); renderRanking(); });
const rk = await page.evaluate(()=>{
  const ano = document.getElementById('ranking-year').value, rows = computeRanking(ano);
  const cards = [...document.querySelectorAll('#ranking-table .jogador-card')];
  return { ano, linhas: rows.length, cartoes: cards.length,
    todosAbertos: cards.every(c=>c.classList.contains('aberto')),
    hexBate: cards.every((c,i)=> c.querySelector('.jc-hex span').textContent === String(i+1)),
    metricasBatem: cards.every((c,i)=> { const v=[...c.querySelectorAll('.jc-metrica')].map(m=>m.querySelector('.jc-valor').textContent); return v[0]===String(rows[i].jogos) && v[1]===String(rows[i].titulos) && v[2]===rows[i].pct+'%'; }),
    tabelaSumiu: !document.querySelector('#ranking-table table'), podioMantido: !!document.querySelector('#ranking-table .rk-podio') };
});
// trocar o ano: o hexágono segue o ano escolhido
const anos = await page.evaluate(()=> [...document.getElementById('ranking-year').options].map(o=>o.value));
let outroAno = null;
if(anos.length > 1){
  outroAno = await page.evaluate((a)=>{ const s=document.getElementById('ranking-year'); s.value=a; renderRanking(); const rows=computeRanking(a);
    const cards=[...document.querySelectorAll('#ranking-table .jogador-card')]; return { ano:a, linhas:rows.length, cartoes:cards.length, hexBate: cards.every((c,i)=> c.querySelector('.jc-hex span').textContent===String(i+1)) }; }, anos[1]);
}
// Títulos abre as datas UMA vez (o Top 5 do Início também está renderizado)
await page.evaluate(()=>{ renderDashboard(); document.getElementById('ranking-year').selectedIndex = 0; renderRanking(); });
const cliqueTitulos = await page.evaluate(()=>{
  const antes = document.body.children.length;
  const el = document.querySelector('#ranking-table [data-ranking-titulos]'); el.click();
  return { novosNoBody: document.body.children.length - antes };
});
await page.evaluate(()=>{ [...document.body.children].filter(e=>e.className && /overlay/.test(e.className)).forEach(e=>e.remove()); });
// isolamento entre telas: abrir no Ranking não abre na aba Jogadores
const iso = await page.evaluate(()=>{
  const c = document.querySelector('#ranking-table .jogador-card'); const id = c.dataset.jcId;
  c.querySelector('.jc-toggle').click(); c.querySelector('.jc-toggle').click();              // abre e fecha
  c.querySelector('.jc-toggle').click();                                                     // abre de novo
  renderPlayers();
  const naLista = document.querySelector('#player-list .jogador-card[data-jc-id="'+id+'"]');
  return { abertoNaListaJogadores: naLista ? naLista.classList.contains('aberto') : null };
});
// Top 5 do Início
await page.evaluate(()=>{ document.querySelector('#nav button[data-view="dashboard"]').click(); renderDashboard(); });
const top5 = await page.evaluate(()=>({ cartoes: document.querySelectorAll('#dash-top5 .jogador-card').length, tabela: !!document.querySelector('#dash-top5 table') }));
```
Esperado: `rk.linhas === rk.cartoes`, `todosAbertos`, `hexBate`, `metricasBatem`, `tabelaSumiu` e `podioMantido` `true`; `outroAno.hexBate` `true` e `outroAno.cartoes === outroAno.linhas`; `cliqueTitulos.novosNoBody === 1` (a janela de datas abre **uma** vez); `iso.abertoNaListaJogadores === false`; `top5.cartoes` entre 1 e 5 e `top5.tabela === false`. Nenhum `pageerror`. Screenshots do `#ranking-table` (escuro/claro) e do `#dash-top5`.

- [ ] **Step 7: Commit**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
git add volei-dashboard.html
git commit -m "$(cat <<'EOF'
Ranking e Top 5 do Início em cartões abertos, com as métricas do ano

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 (2A): Hall da Fama, Duplas, Panelas, Defuntos e versão 9.1

**Files:**
- Modify: `volei-dashboard.html` — `renderHallDaFama`, `renderDuos`, `renderPanelas`, `renderDefuntos`, CSS, rodapé, changelog

- [ ] **Step 1: Ler o trecho exato que muda de tela e conferir o texto do `panela-vs`**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
grep -n 'class="panela-vs"' volei-dashboard.html | cut -c1-260
grep -n "^  \.hall-winners\|^  \.hall-winner{\|^  \.duo-row{\|^  \.duo-list\|^  \.panela-card{\|^  \.panela-players" volei-dashboard.html | cut -c1-160
```
Conferir que a linha `panela-vs` termina em `+${p.diff.toFixed(1)}</span></div>` (é o texto reproduzido no Step 4).

- [ ] **Step 2: Hall da Fama**

Salvar como `TMP/f_hall.js` e trocar a função (o listener `hall-tabs` logo abaixo **não** faz parte dela e fica):

```javascript
function renderHallDaFama(modo){
  const container = document.getElementById('hall-content');
  const dados = computeHallDaFama();
  const lista = modo === 'anual' ? dados.anual : dados.mensal;
  if(lista.length === 0){
    container.innerHTML = '<div class="empty"><i class="ti ti-trophy"></i>Ainda sem rodadas com vencedor definido pra montar o Hall da Fama.</div>';
    return;
  }
  const ctx = contextoCards();
  container.innerHTML = `<div class="hall-grid">${lista.map(item=>{
    const rotulo = modo === 'anual' ? item.periodo : formatarPeriodoMensal(item.periodo);
    return `<div class="hall-card">
      <div class="hall-period">${rotulo}</div>
      <div class="hall-winners">${item.vencedores.map(v=>{
        const p = getPlayer(v.id);
        if(!p) return '';
        // o 🏆 e o "N× na foto" que ficavam soltos ao lado do avatar agora vão numa tag do cartão
        return cartaoDaTela('hall', p, ctx, { tagsExtraHtml: `<span class="jc-tag jc-tag-ouro">🏆 ${v.count}× na foto</span>` });
      }).join('')}</div>
    </div>`;
  }).join('')}</div>`;
}
```

```bash
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/troca_funcao.js" renderHallDaFama "$TMP/f_hall.js"
```

- [ ] **Step 3: Duplas**

Salvar como `TMP/f_duos.js`:

```javascript
function renderDuos(){
  popularSeletorDeAno('duos-year');
  const ano = document.getElementById('duos-year').value;
  const container = document.getElementById('dash-duos');
  const duos = computeTopDuos(ano);
  if(duos.length===0){
    container.innerHTML = `<div class="empty"><i class="ti ti-users"></i>Nenhuma dupla formada em ${ano} ainda.</div>`;
    return;
  }
  const ctx = contextoCards();
  // jogador removido continua aparecendo como texto: a dupla é histórica, não some da lista
  const cartao = pid => { const p = getPlayer(pid); return p ? cartaoDaTela('duplas', p, ctx) : '<div class="duo-removido">(removido)</div>'; };
  container.innerHTML = `<div class="duo-list">${duos.map((d,i)=>`<div class="duo-row duo-cartoes">
      <span class="duo-rank">${i+1}º</span>
      <div class="duo-cartao">${cartao(d.id1)}</div>
      <span class="duo-plus">+</span>
      <div class="duo-cartao">${cartao(d.id2)}</div>
      <span class="duo-count">${d.count}×</span>
    </div>`).join('')}</div>`;
}
```

```bash
node "$TMP/troca_funcao.js" renderDuos "$TMP/f_duos.js"
```

- [ ] **Step 4: Panelas**

Salvar como `TMP/f_panelas.js` (os dois `addEventListener('change', ...)` de `duos-year`/`panelas-year` logo abaixo **não** fazem parte da função):

```javascript
function renderPanelas(){
  popularSeletorDeAno('panelas-year');
  const ano = document.getElementById('panelas-year').value;
  const container = document.getElementById('dash-panelas');
  const panelas = computePanelas(ano).filter(p=> p.diff > 0);
  if(panelas.length===0){
    container.innerHTML = `<div class="empty"><i class="ti ti-scale"></i>Nenhuma panela formada em ${ano} ainda (times precisam ter jogadores com nota de estrelas para calcular isso).</div>`;
    return;
  }
  const ctx = contextoCards();
  container.innerHTML = panelas.map((p,i)=>{
    // jogador removido é omitido da grade (o cartão precisa de um jogador de verdade)
    const cartoes = p.playerIds.map(pid=> getPlayer(pid)).filter(Boolean).map(pl=> cartaoDaTela('panelas', pl, ctx)).join('');
    return `<div class="panela-card">
      <div class="panela-head">
        <span class="panela-rank">${i+1}º — ${escapeHtml(p.teamNome)}</span>
        <span class="panela-date">${formatDate(p.data)}</span>
      </div>
      <div class="panela-cartoes">${cartoes}</div>
      <div class="panela-vs">Média do time: <span class="panela-gap">★${p.mediaTime.toFixed(1)}</span> · demais times: ★${p.mediaOutros.toFixed(1)} · diferença: <span class="panela-gap">+${p.diff.toFixed(1)}</span></div>
    </div>`;
  }).join('');
}
```

```bash
node "$TMP/troca_funcao.js" renderPanelas "$TMP/f_panelas.js"
```

- [ ] **Step 5: Defuntos**

Salvar como `TMP/f_defuntos.js`:

```javascript
function renderDefuntos(){
  const container = document.getElementById('dash-defuntos');
  const ctx = contextoCards();
  const badges = ctx.badges; // o mesmo computeBadges que o cartão usa: calculado uma vez só
  const ultimaVez = computeUltimaParticipacao();
  const agora = Date.now();
  const lista = DATA.players
    .filter(p=> badges.aposentado.has(p.id))
    .map(p=>({ p, dias: Math.floor((agora - (ultimaVez[p.id]||agora)) / DIA_MS) }))
    .sort((a,b)=> b.dias - a.dias);
  if(lista.length===0){
    container.innerHTML = '<div class="empty"><i class="ti ti-ghost-2"></i>Ninguém sumiu por mais de 100 dias até agora — cemitério vazio! 🪦</div>';
    return;
  }
  container.innerHTML = `<div class="defuntos-cartoes">${lista.map(({p,dias})=>
    cartaoDaTela('defuntos', p, ctx, { tagsExtraHtml: `<span class="jc-tag-alerta">${dias} dias sem jogar</span>` })
  ).join('')}</div>`;
}
```

```bash
node "$TMP/troca_funcao.js" renderDefuntos "$TMP/f_defuntos.js"
```

- [ ] **Step 6: CSS**

Antes de `</style>`:

```css
  /* Hall, Duplas, Panelas e Defuntos com cartão completo */
  .hall-winners{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;}
  .panela-cartoes, .defuntos-cartoes{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin:8px 0;}
  .duo-cartoes{display:grid;grid-template-columns:auto minmax(0,1fr) auto minmax(0,1fr) auto;align-items:center;gap:10px;}
  .duo-cartao{min-width:0;}
  .duo-removido{color:var(--muted);font-size:13px;padding:10px;}
  @media (max-width:700px){
    /* celular: um cartão embaixo do outro, com o "+" no meio */
    .duo-cartoes{display:flex;flex-direction:column;align-items:stretch;gap:6px;}
    .duo-cartoes .duo-rank, .duo-cartoes .duo-count{align-self:flex-start;}
    .duo-cartoes .duo-plus{align-self:center;}
  }
```

- [ ] **Step 7: Versão 9.1 e Log de Alterações**

Rodapé `Ver.: 9.0 ·` → `Ver.: 9.1 ·`. Em `#info-changelog`, inserir antes da entrada v9.0 uma nova com `open` e **remover** o `open` da v9.0:

```html
        <details class="dash-accordion" open>
          <summary>19/09/2026 — v9.1: Cartão do jogador no Ranking, Hall e estatísticas</summary>
          <div>
            <p style="line-height:1.6;">O <strong>Ranking</strong> (e o Top 5 do Início) agora é uma lista de cartões abertos: o número no hexágono é a posição no ano escolhido e as métricas são desse ano. O toque em <strong>Títulos</strong> continua mostrando as datas de campeão.</p>
            <p style="line-height:1.6;">O <strong>Hall da Fama</strong>, as <strong>Duplas</strong>, as <strong>Maiores Panelas</strong> e os <strong>Defuntos</strong> também usam o cartão do jogador.</p>
          </div>
        </details>

        <details class="dash-accordion">
          <summary>19/09/2026 — v9.0: Cartão do jogador nas listas e times</summary>
```

- [ ] **Step 8: Testes, sintaxe e restos**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
SP="$TMP/c--Users-Heleno-OneDrive-Documentos-GitHub-voleis-VS/18a97619-5c6e-4fd5-843b-2fe350637e40/scratchpad"
node "$TMP/test_card.js" && node "$TMP/test_card_dados.js" && node "$SP/test_som.js" && node "$SP/test_podio.js" && node "$SP/test_radar.js"
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.argv[1]+'/check_html.js',m[1]);" "$TMP" && node --check "$TMP/check_html.js" && echo "SINTAXE OK"
grep -o "Ver\.: [0-9.]*" volei-dashboard.html
```
Expected: 5 linhas `OK — ...`, `SINTAXE OK` e `Ver.: 9.1`.

- [ ] **Step 9: Verificação no navegador**

`SP/verif_2a.js`:

```javascript
await page.evaluate(()=>{ SETTINGS.estrelasVisiveis = true; document.querySelector('#nav button[data-view="dashboard"]').click(); renderDashboard(); });
const ini = await page.evaluate(()=>{
  const ano = document.getElementById('duos-year').value, duos = computeTopDuos(ano);
  const pano = document.getElementById('panelas-year').value, panelas = computePanelas(pano).filter(p=>p.diff>0);
  const badges = computeBadges(), defuntos = DATA.players.filter(p=>badges.aposentado.has(p.id)).length;
  return {
    duplas: { linhas: duos.length, rows: document.querySelectorAll('#dash-duos .duo-cartoes').length, cartoes: document.querySelectorAll('#dash-duos .jogador-card').length, esperados: duos.reduce((n,d)=> n + (getPlayer(d.id1)?1:0) + (getPlayer(d.id2)?1:0), 0) },
    panelas: { cards: panelas.length, rows: document.querySelectorAll('#dash-panelas .panela-card').length, cartoes: document.querySelectorAll('#dash-panelas .jogador-card').length, vs: document.querySelectorAll('#dash-panelas .panela-vs').length },
    defuntos: { esperados: defuntos, cartoes: document.querySelectorAll('#dash-defuntos .jogador-card').length, tagsAlerta: document.querySelectorAll('#dash-defuntos .jc-tag-alerta').length }
  };
});
await page.evaluate(()=>{ document.querySelector('#nav button[data-view="hall"]').click(); renderHallDaFama('mensal'); });
const hall = await page.evaluate(()=>{ const d = computeHallDaFama().mensal; const esperados = d.reduce((n,i)=> n + i.vencedores.filter(v=>getPlayer(v.id)).length, 0);
  return { esperados, cartoes: document.querySelectorAll('#hall-content .jogador-card').length, tags: document.querySelectorAll('#hall-content .jc-tag-ouro').length, semAvatarAntigo: !document.querySelector('#hall-content .hall-trophy') }; });
await page.evaluate(()=> renderHallDaFama('anual'));
const hallAnual = await page.evaluate(()=>({ cartoes: document.querySelectorAll('#hall-content .jogador-card').length }));
```
Esperado: `duplas.rows === duplas.linhas`, `duplas.cartoes === duplas.esperados`; `panelas.rows === panelas.cards`, `panelas.vs === panelas.cards`; `defuntos.cartoes === defuntos.esperados === defuntos.tagsAlerta`; `hall.cartoes === hall.esperados === hall.tags` e `hall.semAvatarAntigo`; `hallAnual.cartoes > 0`; nenhum `pageerror`. A 390px: `scrollWidth - clientWidth === 0` no Início, no Ranking e no Hall; screenshot de `#dash-duos` em 390px (cartões empilhados) e do `#dash-panelas`.

- [ ] **Step 10: Commit**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
git add volei-dashboard.html
git commit -m "$(cat <<'EOF'
Hall da Fama, Duplas, Panelas e Defuntos com o cartão completo (v9.1)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 (2B): Top 10 de fotos

**Files:**
- Modify: `volei-dashboard.html` — `renderPhotoChart` (3 trechos), CSS

**Interfaces:**
- Consumes: `cartaoDaTela`, `contextoCards`. Os itens de `computePhotoCounts` são `{ id, nome, apelido, foto, vezes, ultimaConquista }` (**não** são jogadores): o cartão usa `getPlayer(d.id)`.

- [ ] **Step 1: Trocar os trechos de `renderPhotoChart`**

Salvar como `TMP/f_fotos.json` (o script exige que cada trecho apareça **uma vez** dentro da função):

```json
[
  ["  const badges = computeBadges();\n  const max = data[0].vezes;",
   "  const ctxCards = contextoCards(); // uma vez por render; o cartão precisa de emblemas e posição\n  const max = data[0].vezes;"],
  ["  function blocoSecundario(d, posicaoReal){\n    return `<div class=\"podium-secundaria-item clickable-name\" data-open-profile=\"${d.id}\">\n      <div class=\"podium-secundaria-rank\">${posicaoReal}º</div>\n      ${avatarHtml({foto:d.foto, nome:d.nome},'sm')}\n      <div class=\"podium-secundaria-nome\">${nomeComApelidoHtml(d)}</div>\n      <div class=\"podium-secundaria-count\" id=\"podium-count-${posicaoReal}\">0×</div>\n    </div>`;\n  }",
   "  // 2º/3º da faixa de empate: viram cartão. O contador animado continua com o MESMO id (podium-count-N),\n  // agora dentro da tag do cartão; a animação (animarContador) escreve \"N×\" nele.\n  function blocoSecundario(d, posicaoReal){\n    const p = getPlayer(d.id);\n    if(!p) return '';\n    return cartaoDaTela('fotos', p, ctxCards, {\n      tagsExtraHtml: `<span class=\"jc-tag jc-tag-ouro\">${posicaoReal}º · <span id=\"podium-count-${posicaoReal}\">0×</span></span>`\n    });\n  }"],
  ["  const listaHtml = restanteLista.length ? `<div class=\"leaderboard-list\">${restanteLista.map((d,i)=>{\n    const posicao = i + 4;\n    return `<div class=\"leaderboard-row\">\n      <div class=\"leaderboard-rank\">${posicao}º</div>\n      ${avatarHtml({foto:d.foto, nome:d.nome},'sm')}\n      <div class=\"leaderboard-name clickable-name\" data-open-profile=\"${d.id}\">${nomeComApelidoHtml(d)}${badgeIconsHtml(d.id, badges)}</div>\n      <div class=\"leaderboard-track\"><div class=\"leaderboard-fill\" id=\"lb-fill-${i}\"></div></div>\n      <div class=\"leaderboard-count\" id=\"lb-count-${i}\">0</div>\n    </div>`;\n  }).join('')}</div>` : '';",
   "  const listaHtml = restanteLista.length ? `<div class=\"leaderboard-list leaderboard-cartoes\">${restanteLista.map((d,i)=>{\n    const p = getPlayer(d.id);\n    if(!p) return ''; // jogador removido: sem cartão (a animação ignora ids que não existem)\n    const posicao = i + 4;\n    // ids lb-count-N / lb-fill-N preservados: a animação do gráfico continua apontando pra eles\n    return cartaoDaTela('fotos', p, ctxCards, {\n      tagsExtraHtml: `<span class=\"jc-tag jc-tag-ouro\">${posicao}º · <span id=\"lb-count-${i}\">0</span>× na foto</span><div class=\"leaderboard-track jc-barra\"><div class=\"leaderboard-fill\" id=\"lb-fill-${i}\"></div></div>`\n    });\n  }).join('')}</div>` : '';"]
]
```

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/edita_funcao.js" renderPhotoChart "$TMP/f_fotos.json"
```
Se aparecer `0 ocorrências`, **parar**: ler o trecho atual da função (`sed -n '/^function renderPhotoChart/,/^}/p'`) e ajustar o texto de busca; não forçar.

- [ ] **Step 2: CSS**

Antes de `</style>`:

```css
  /* Top 10 de fotos: 4º em diante em cartões; a barra de progresso ocupa a linha de baixo da tag */
  .leaderboard-cartoes{display:flex;flex-direction:column;gap:8px;}
  .jc-linha-tags .jc-barra{flex:1 1 100%;height:6px;margin-top:2px;}
```

- [ ] **Step 3: Sintaxe e restos**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.argv[1]+'/check_html.js',m[1]);" "$TMP" && node --check "$TMP/check_html.js" && echo "SINTAXE OK"
sed -n '/^function renderPhotoChart/,/^function animarContador/p' volei-dashboard.html | grep -c "badges\|badgeIconsHtml"
```
Expected: `SINTAXE OK` e `0`.

- [ ] **Step 4: Verificação no navegador**

`SP/verif_fotos.js`:

```javascript
await page.evaluate(()=>{ document.querySelector('#nav button[data-view="dashboard"]').click(); renderDashboard(); });
await new Promise(r=>setTimeout(r,1500));                         // deixa a animação dos contadores terminar
const ft = await page.evaluate(()=>{
  const ano = document.getElementById('photo-chart-year').value, dados = computePhotoCounts(ano);
  const max = dados[0].vezes, empatado = dados.filter(d=>d.vezes===max).length > 1;
  const resto = dados.slice(empatado ? dados.filter(d=>d.vezes===max).length : 1);
  const restanteLista = empatado ? resto.slice(2) : resto.slice(2);
  const finais = restanteLista.map((d,i)=> ({ esperado: String(d.vezes), atual: (document.getElementById('lb-count-'+i)||{}).textContent, barra: (document.getElementById('lb-fill-'+i)||{}).style && document.getElementById('lb-fill-'+i).style.width }));
  return { empatado, podioMantido: !!document.querySelector('#dash-chart .podium-wrap, #dash-chart .podium-empate-faixa'),
    cartoesLista: document.querySelectorAll('#dash-chart .leaderboard-cartoes .jogador-card').length, esperadosLista: restanteLista.filter(d=>getPlayer(d.id)).length,
    contadoresFinais: finais.every(f=> f.atual === f.esperado), barrasPreenchidas: finais.every(f=> f.barra && f.barra !== '0%'),
    semLinhaAntiga: !document.querySelector('#dash-chart .leaderboard-row'),
    p2: (document.getElementById('podium-count-2')||{}).textContent, p3: (document.getElementById('podium-count-3')||{}).textContent };
});
```
Esperado: `podioMantido`, `contadoresFinais`, `barrasPreenchidas` e `semLinhaAntiga` `true`; `cartoesLista === esperadosLista`; sem `pageerror`. Screenshot de `#dash-chart` (escuro/claro/390px).

- [ ] **Step 5: Commit**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
git add volei-dashboard.html
git commit -m "$(cat <<'EOF'
Top 10 de fotos: 4º em diante e faixa de empate em cartões (pódio mantido)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 (2B): Card de campeões do Início, Ao Vivo e versão 9.2

**Files:**
- Modify: `volei-dashboard.html` — `renderDashboard` (frente e verso), `wireDashFlipCard`, `renderAoVivo`, CSS, rodapé, changelog

- [ ] **Step 1: `renderDashboard` — frente e verso**

Salvar como `TMP/f_dash.json`. As trocas valem **só dentro de `renderDashboard`** (o mesmo `<div class="with-avatar" ...>` existe no Histórico e no Ao Vivo). O primeiro `de` insere o contexto dos cartões no início da função.

```json
[
  ["function renderDashboard(){\n",
   "function renderDashboard(){\n  const ctxCards = contextoCards(); // uma vez por render: o cartão precisa de emblemas e da posição no ranking\n"],
  ["        <div class=\"sb-players\">${names.map(p=>`<span class=\"chip with-avatar\">${avatarHtml(p,'sm')}<span><span class=\"clickable-name\" data-open-profile=\"${p&&p.id}\">${p?escapeHtml(p.nome):'?'}</span>${badgeIconsHtml(p&&p.id, badges)}${p&&p.apelido ? `<div class=\"sub\">\"${escapeHtml(p.apelido)}\"</div>` : ''}</span></span>`).join('')}</div>`;",
   "        <div class=\"sb-jogadores\">${names.filter(Boolean).map(p=> cartaoDaTela('inicio', p, ctxCards)).join('')}</div>`;"],
  ["                  ${t.playerIds.map(pid=>{ const p=getPlayer(pid); return `<div class=\"with-avatar\" style=\"margin-bottom:4px;\">${avatarHtml(p,'sm')}<span class=\"clickable-name\" data-open-profile=\"${pid}\">${p?nomeComApelidoHtml(p):'(removido)'}</span>${badgeIconsHtml(pid, badges)}</div>`; }).join('')}",
   "                  ${t.playerIds.map(pid=>{ const p=getPlayer(pid); return p ? cartaoDaTela('inicio', p, ctxCards) : '<div style=\"color:var(--muted);font-size:12px;margin-bottom:4px;\">(removido)</div>'; }).join('')}"]
]
```

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/edita_funcao.js" renderDashboard "$TMP/f_dash.json"
```
Se algum `de` acusar `0 ocorrências`, **parar**, imprimir o trecho real (`grep -n 'class="sb-players"' volei-dashboard.html`) e ajustar. O `badges` local de `renderDashboard` continua sendo usado nos números "Jogadores Ativos/Desaparecidos", por isso a declaração dele **não** sai.

- [ ] **Step 2: O toque num cartão não vira o quadro**

Em `wireDashFlipCard`, trocar

```javascript
    if(e.target.closest('[data-open-profile]')) return; // clique num jogador: só abre o perfil, não vira
```

por

```javascript
    // clique num jogador (nome) ou em qualquer parte de um cartão (o ">" que expande, as métricas): não vira o quadro
    if(e.target.closest('[data-open-profile], .jogador-card')) return;
```

- [ ] **Step 3: Ao Vivo**

Salvar como `TMP/f_aovivo.json`:

```json
[
  ["function renderAoVivo(){\n",
   "function renderAoVivo(){\n  const ctxCards = contextoCards(); // uma vez por render (roda a cada poll de 9s e a cada clique nos steppers)\n"],
  ["            ${t.playerIds.map(pid=>{ const p=getPlayer(pid); return `<div class=\"with-avatar\" style=\"margin-bottom:4px;\">${avatarHtml(p,'sm')}<span>${p?nomeComApelidoHtml(p):'(removido)'}</span></div>`; }).join('') || '<div style=\"color:var(--muted);font-size:12px;\">Sem jogadores</div>'}",
   "            ${t.playerIds.map(pid=>{ const p=getPlayer(pid); return p ? cartaoDaTela('aovivo', p, ctxCards, null, { semAnimacao: true }) : '<div style=\"color:var(--muted);font-size:12px;margin-bottom:4px;\">(removido)</div>'; }).join('') || '<div style=\"color:var(--muted);font-size:12px;\">Sem jogadores</div>'}"]
]
```

```bash
node "$TMP/edita_funcao.js" renderAoVivo "$TMP/f_aovivo.json"
```

- [ ] **Step 4: CSS**

Antes de `</style>`:

```css
  /* Início: cartões da equipe campeã na frente do quadro (no lugar dos chips com nomes) */
  .sb-jogadores{position:relative;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;}
```

- [ ] **Step 5: Versão 9.2 e Log de Alterações**

Rodapé `Ver.: 9.1 ·` → `Ver.: 9.2 ·`; nova entrada `open` no topo do `#info-changelog` (remover o `open` da v9.1):

```html
        <details class="dash-accordion" open>
          <summary>19/09/2026 — v9.2: Cartão do jogador no Início, no Top 10 de fotos e no Ao Vivo</summary>
          <div>
            <p style="line-height:1.6;">No <strong>Início</strong>, a equipe campeã e os times do verso do quadro aparecem como cartões de jogador (tocar no <strong>&gt;</strong> não vira o quadro). O <strong>Top 10 de fotos</strong> mantém o pódio e mostra do 4º em diante em cartões, com os contadores animados de sempre.</p>
            <p style="line-height:1.6;">No <strong>Ao Vivo</strong>, os jogadores de cada time também são cartões, sem animação de entrada, e os que você abriu continuam abertos quando o placar atualiza.</p>
          </div>
        </details>

        <details class="dash-accordion">
          <summary>19/09/2026 — v9.1: Cartão do jogador no Ranking, Hall e estatísticas</summary>
```

- [ ] **Step 6: Testes, sintaxe e restos**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
SP="$TMP/c--Users-Heleno-OneDrive-Documentos-GitHub-voleis-VS/18a97619-5c6e-4fd5-843b-2fe350637e40/scratchpad"
node "$TMP/test_card.js" && node "$TMP/test_card_dados.js" && node "$SP/test_som.js" && node "$SP/test_podio.js" && node "$SP/test_radar.js"
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.argv[1]+'/check_html.js',m[1]);" "$TMP" && node --check "$TMP/check_html.js" && echo "SINTAXE OK"
grep -o "Ver\.: [0-9.]*" volei-dashboard.html
sed -n '/^function renderAoVivo/,/^function /p' volei-dashboard.html | grep -c 'class="with-avatar"'
```
Expected: 5 linhas `OK — ...`, `SINTAXE OK`, `Ver.: 9.2` e `0` (o Ao Vivo não usa mais a linha antiga).

- [ ] **Step 7: Verificação no navegador**

`SP/verif_2b.js`:

```javascript
// Início: frente e verso
await page.evaluate(()=>{ SETTINGS.estrelasVisiveis = true; document.querySelector('#nav button[data-view="dashboard"]').click(); renderDashboard(); });
const ini = await page.evaluate(()=>{
  const wrap = document.getElementById('dash-flip-wrap');
  return { existe: !!wrap, frente: document.querySelectorAll('.flip-card-front .jogador-card').length, verso: document.querySelectorAll('.flip-card-back .jogador-card').length,
    semChipsAntigos: !document.querySelector('.flip-card-front .sb-players'), semLinhasAntigas: !document.querySelector('.flip-card-back .with-avatar') };
});
// tocar num cartão NÃO vira; tocar fora vira
const flip = await page.evaluate(()=>{
  const wrap = document.getElementById('dash-flip-wrap'), inner = document.getElementById('dash-flip-inner');
  const cartao = document.querySelector('.flip-card-front .jogador-card .jc-info'); const antes = wrap.classList.contains('virado');
  cartao.click(); const aposCartao = wrap.classList.contains('virado');
  const tog = document.querySelector('.flip-card-front .jc-toggle'); if(tog) tog.click(); const aposToggle = wrap.classList.contains('virado');
  document.querySelector('.flip-card-front .sb-label').click(); const aposFora = wrap.classList.contains('virado');
  return { antes, aposCartao, aposToggle, aposFora };
});
// Ao Vivo: transmissão simulada com jogadores reais
await page.evaluate(()=>{
  const ps = DATA.players.slice(0, 6);
  DATA.aoVivo = { rounds: [{ id:'av_teste', data:'2026-09-19', iniciadoEm:new Date().toISOString(), duracaoMinutos:120,
    times:[{ nome:'Time A', playerIds:ps.slice(0,3).map(p=>p.id), vitorias:2 }, { nome:'Time B', playerIds:ps.slice(3,6).map(p=>p.id), vitorias:1 }] }], log: [] };
  document.querySelector('#nav button[data-view="aovivo"]').click(); renderAoVivo();
});
const av = await page.evaluate(()=>{
  const cards = [...document.querySelectorAll('#aovivo-list .jogador-card')];
  const sem = cards.every(c=> getComputedStyle(c).animationName === 'none');
  const semDentro = [...document.querySelectorAll('#aovivo-list .aovivo-card *')].every(e=> getComputedStyle(e).animationName === 'none');
  const t = cards.find(c=>c.querySelector('.jc-toggle')); const id = t ? t.dataset.jcId : null;
  if(t) t.querySelector('.jc-toggle').click();
  renderAoVivo();                                                      // simula o poll de 9s
  const reabriu = id ? document.querySelector('#aovivo-list .jogador-card[data-jc-id="'+id+'"]').classList.contains('aberto') : null;
  return { cartoes: cards.length, esperados: 6, semAnimacaoNosCartoes: sem, nadaAnimaDentro: semDentro, abertoSobreviveAoPoll: reabriu, colunasLargas: getComputedStyle(document.querySelector('#aovivo-list .history-teams')).gridTemplateColumns.split(' ').length };
});
await page.evaluate(()=>{ DATA.aoVivo = { rounds: [], log: [] }; });
// isolamento: abrir no Ao Vivo não abre o mesmo jogador no Ranking/Jogadores (chaves por tela)
const chaves = await page.evaluate(()=> [...JOGADOR_CARD_ABERTOS].filter(k=>k.startsWith('aovivo:')).length);
```
Esperado: `ini.existe`, `ini.frente > 0`, `ini.verso > 0`, `semChipsAntigos`, `semLinhasAntigas` `true`; `flip`: `antes === false`, `aposCartao === false`, `aposToggle === false` e `aposFora === true`; `av.cartoes === 6`, `semAnimacaoNosCartoes` e `nadaAnimaDentro` `true`, `abertoSobreviveAoPoll === true`; `chaves >= 1`; nenhum `pageerror`. A 390px: `scrollWidth - clientWidth === 0` no Início e no Ao Vivo. Screenshots: frente e verso do quadro (o verso girando via `wrap.classList.add('virado')`), Ao Vivo com um cartão aberto.

**Se o cartão dentro do verso do quadro tremer, sumir ou ficar espelhado** (container queries + `preserve-3d`), o plano de contingência do spec é usar o cartão reduzido no verso: trocar `cartaoDaTela('inicio', p, ctxCards)` do verso por `jogadorCardHtml(montarDadosReduzido(p, starsVisibleNow()), { variante: 'reduzido' })`, registrar no spec e seguir.

- [ ] **Step 8: Commit**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
git add volei-dashboard.html
git commit -m "$(cat <<'EOF'
Início (quadro de campeões) e Ao Vivo com o cartão completo (v9.2)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Depois deste plano

Conforme o CLAUDE.md: **parar aqui** e mostrar o resultado só no Terça. O Meme só recebe as Fases 1 e 2 depois de autorização explícita, pelo merge de 3 vias (base = Terça antes do cartão reduzido; versões LF via `git show`), como nas réplicas anteriores. Sem mudança de backend.
