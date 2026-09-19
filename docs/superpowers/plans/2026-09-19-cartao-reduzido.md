# Cartão do Jogador reduzido (Fase 1) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o cartão do jogador, em uma variação **reduzida** (sem hexágono, sem emblemas, sem `>`; só ♂/♀ e estrelinhas), para Check-in, Sorteio (lista, grupos e times sorteados), Histórico de rodadas e Nova Rodada.

**Architecture:** A função pura `jogadorCardHtml` ganha a variante `'reduzido'` e campos opcionais (`nomeHtml`, `apelidoHtml`, `leadingHtml`, `opcoes.nomeAbrePerfil`, `opcoes.classesExtra`, `opcoes.atributos`). Um construtor fino e barato, `montarDadosReduzido`, monta os dados (sem badges, ranking ou estatísticas). Cada tela troca só o trecho de marcação do jogador, mantendo os handlers existentes (label do check-in, checkbox do sorteio, `.draft-chip` arrastável).

**Tech Stack:** HTML + CSS + JS puro; Tabler Icons já carregado; sem biblioteca nova.

**Spec:** `docs/superpowers/specs/2026-09-19-cartao-reduzido-design.md` (depende do cartão completo, spec `2026-09-18-card-jogador-design.md`)

## Global Constraints

- Só o **Terça** (`volei-dashboard.html`). Nada em `volei-meme-dashboard.html` nem `.gs` sem autorização explícita. Sem mudança de backend.
- Toda mudança em JS passa pela validação de sintaxe (comando exato em cada task).
- Versão do rodapé `Ver.: 8.9` → `Ver.: 9.0` (Task 4), com entrada no Log de Alterações.
- O cartão reduzido **não anima de entrada** (Check-in e Sorteio re-renderizam a lista inteira a cada clique).
- Nada de `backdrop-filter` no cartão.
- **Fora desta fase:** `renderAoVivo`, `renderDashboard` (Início), Ranking, Hall, Duplas, Panelas, Defuntos, gráfico de fotos, `renderCheckinOrdenados`, itens do dropdown do picker (`wirePickers`), modo de edição da aba Jogadores.
- Arrastar e soltar (`.draft-chip` + `data-player-id` + `data-from-team`/`data-from-group`), o `<label data-checkin-toggle>` + `[data-checkin-btn]` e o `input[type=checkbox][data-id]` do Sorteio **não podem quebrar**.
- No Check-in e no Sorteio (lista) o nome **não** abre o perfil (`nomeAbrePerfil:false`).
- Modo claro legível; nenhuma rolagem horizontal em 390px.
- Comentários em português explicando o *porquê*; nomes de função em português.
- Ambiente Windows: `TMP="C:/Users/Heleno/AppData/Local/Temp/claude"`. Testes ficam em `TMP` (não versionados). O arquivo no disco é CRLF (autocrlf): scripts que editam o HTML devem preservar CRLF.
- Branch de trabalho: `card-jogador`. Cada task termina com um commit.

## Estrutura de arquivos

- **Modificar apenas:** `volei-dashboard.html`
  - Bloco `// <jogador-card-puro>`: nova versão de `jogadorCardHtml`
  - Bloco `// <card-dados>`: nova `montarDadosReduzido`
  - `<style>`: bloco novo no fim (antes de `</style>`)
  - Templates de: `renderCheckinList`, `renderSorteioList`, `renderGroupsInto`, `renderDraftResult`, `renderHistory` (2 pontos), `renderRodadaGuestChips`, `playerTriggerHtml`
  - Rodapé e `#info-changelog`
- **Fora do repositório:** `TMP/test_card.js` e `TMP/test_card_dados.js` (estendidos), scripts de navegador em `TMP/…/scratchpad`.

---

## Task 1: Variante `reduzido` no componente puro, `montarDadosReduzido` e CSS

**Files:**
- Modify: `volei-dashboard.html` (bloco puro, bloco `card-dados`, CSS)
- Test (fora do repo): `TMP/test_card.js`, `TMP/test_card_dados.js`

**Interfaces:**
- Produces: `jogadorCardHtml(d, opcoes)` estendida. Campos novos de `d` (opcionais): `nomeHtml`, `apelidoHtml` (HTML **já escapado**), `leadingHtml`. Campos novos de `opcoes`: `variante:'reduzido'`, `nomeAbrePerfil` (bool; padrão `!perfil`), `classesExtra` (string), `atributos` (string de atributos HTML já confiáveis).
- Produces: `montarDadosReduzido(p, mostrarEstrelas, extras?)` → `{ id, nome, apelido, foto, sexo, estrelasHtml, ...extras }`.

- [ ] **Step 1: Estender o teste do componente**

Acrescentar ao **fim** de `TMP/test_card.js`, **antes** da linha `console.log('OK — cartão do jogador');`:

```javascript
// ===== variante REDUZIDO =====
const emb2 = '<span class="badge-icon">📸</span>';
const red = (over, op) => jogadorCardHtml(
  Object.assign({}, base, { estrelasHtml:'', posicao:5, temConta:true, emblemasHtml:emb2 }, over),
  Object.assign({ variante:'reduzido' }, op || {}));

const r0 = red({});
assert.ok(r0.includes('jc-reduzido') && r0.includes('jc-sexo'));                 // só o símbolo ♂/♀
assert.ok(!r0.includes('jc-hex') && !r0.includes('badge-icon') && !r0.includes('jc-icone-conta'));  // sem hexágono, emblemas nem "G"
assert.ok(!r0.includes('jc-painel') && !r0.includes('jc-toggle') && !r0.includes('jc-metrica'));    // sem painel nem ">"
assert.ok(!/\baberto\b/.test(red({}, { aberto:true })));

// estrelinhas ficam na linha do nome (não na linha de tags)
const glifosR = '<span class="stars-display">★★★★★</span>';
const r1 = red({ estrelasHtml:glifosR });
assert.ok(r1.includes('<span class="jc-estrelas">' + glifosR + '</span>') && !r1.includes('jc-linha-tags'));
assert.ok(!red({}).includes('jc-estrelas'));                                       // sem estrelas: nada

// nomeHtml/apelidoHtml entram SEM re-escapar (o destaque da busca já vem escapado)
const hl = red({ nomeHtml:'A<mark class="picker-match">n</mark>a', apelidoHtml:'<mark>x</mark>' });
assert.ok(hl.includes('A<mark class="picker-match">n</mark>a') && hl.includes('"<mark>x</mark>"'));
assert.ok(!red({ apelidoHtml:'' }).includes('jc-apelido'));                       // apelido vazio: sem linha
// sem nomeHtml, o nome continua escapado
assert.ok(red({ nome:'<b>x</b>' }).includes('&lt;b&gt;'));

// leadingHtml (checkbox do Sorteio)
assert.ok(red({ leadingHtml:'<input type="checkbox" data-id="p1">' }).includes('<div class="jc-leading"><input type="checkbox" data-id="p1"></div>'));
assert.ok(!red({}).includes('jc-leading'));

// nome abre o perfil por padrão; Check-in/Sorteio desligam
assert.ok(red({}).includes('data-open-profile="p1"'));
assert.ok(!red({}, { nomeAbrePerfil:false }).includes('data-open-profile'));
assert.ok(!c({}, { variante:'perfil' }).includes('data-open-profile'));           // perfil continua sem
assert.ok(c({}, { variante:'perfil', nomeAbrePerfil:true }).includes('data-open-profile="p1"'));

// o cartão pode SER o .draft-chip arrastável
const chip = red({}, { classesExtra:'draft-chip', atributos:'draggable="true" data-player-id="p1" data-from-team="2"' });
assert.ok(/class="jogador-card jc-reduzido draft-chip"/.test(chip));
assert.ok(chip.includes(' draggable="true" data-player-id="p1" data-from-team="2">'));

// tags (convidado) e ações passam direto
assert.ok(red({ tagsExtraHtml:'<span class="badge-guest">convidado</span>' }).includes('badge-guest'));
assert.ok(red({ acoesHtml:'<button>x</button>' }).includes('<div class="jc-acoes"><button>x</button></div>'));

// sexo vazio: sem símbolo; estrelas ajustadas (vermelhas) só passam pelo HTML pronto
assert.ok(!red({ sexo:'' }).includes('jc-sexo'));

// a variante 'lista' NÃO mudou: continua com hexágono, emblemas, painel e ">"
const l2 = c({ posicao:5, temConta:true, emblemasHtml:emb2 }, { variante:'lista' });
assert.ok(l2.includes('jc-hex') && l2.includes('badge-icon') && l2.includes('jc-icone-conta') && l2.includes('jc-toggle'));

// divs balanceadas em todas as combinações do reduzido
[ {}, { estrelasHtml:glifosR, leadingHtml:'<i></i>', acoesHtml:'<b></b>', tagsExtraHtml:'<u></u>' }, { metricas:null, foto:'x.jpg' } ].forEach(over => {
  [ {}, { nomeAbrePerfil:false }, { classesExtra:'draft-chip', atributos:'draggable="true"' } ].forEach(op => {
    const h = red(over, op);
    assert.strictEqual(n(h, '<div'), n(h, '</div>'), 'divs desbalanceadas: ' + JSON.stringify(over) + JSON.stringify(op));
  });
});
```

- [ ] **Step 2: Estender o teste dos dados**

Em `TMP/test_card_dados.js`: (a) trocar o retorno do `new Function` para incluir `montarDadosReduzido`; (b) trocar o stub de `starsDisplay` para marcar a nota ajustada; (c) acrescentar as asserções no fim, antes do `console.log`.

(a) `trecho + '; return { contextoCards, montarDadosCard };'` → `trecho + '; return { contextoCards, montarDadosCard, montarDadosReduzido };'` e `const { contextoCards, montarDadosCard } = new Function(` → `const { contextoCards, montarDadosCard, montarDadosReduzido } = new Function(`.

(b) `n => (parseFloat(n) > 0 ? '<estrelas:' + n + '>' : '')` → `(n, aj) => (parseFloat(n) > 0 ? '<estrelas:' + n + (aj ? ':aj' : '') + '>' : '')`.

(c) Antes de `console.log('OK — dados do cartão');`:

```javascript
// ===== montarDadosReduzido =====
const rz = montarDadosReduzido({ id:'a', nome:'Ana', apelido:'An', foto:'f.jpg', sexo:'F', estrelas:4.5 }, true);
assert.deepStrictEqual(rz, { id:'a', nome:'Ana', apelido:'An', foto:'f.jpg', sexo:'F', estrelasHtml:'<estrelas:4.5>' });
assert.strictEqual(montarDadosReduzido({ id:'a', nome:'A', estrelas:4 }, false).estrelasHtml, '');     // oculta pelo admin
assert.strictEqual(montarDadosReduzido({ id:'a', nome:'A', estrelas:0 }, true).estrelasHtml, '');      // sem nota
assert.strictEqual(montarDadosReduzido({ id:'a', nome:'A' }, true).estrelasHtml, '');                  // sem estrelas cadastradas
assert.strictEqual(montarDadosReduzido({ id:'a', nome:'A', estrelas:'3.5' }, true).estrelasHtml, '<estrelas:3.5>'); // texto vindo da planilha
assert.strictEqual(montarDadosReduzido({ id:'a', nome:'A', estrelas:3, _estrelaAjustada:true }, true).estrelasHtml, '<estrelas:3:aj>'); // nota ajustada do sorteio
const gz = montarDadosReduzido({ id:'g1', nome:'Gui', isGuest:true, estrelas:3 }, true);              // convidado: sem foto/apelido/sexo
assert.strictEqual(gz.foto, ''); assert.strictEqual(gz.apelido, ''); assert.strictEqual(gz.sexo, '');
const ez = montarDadosReduzido({ id:'a', nome:'A' }, true, { tagsExtraHtml:'X', acoesHtml:'Y' });
assert.strictEqual(ez.tagsExtraHtml, 'X'); assert.strictEqual(ez.acoesHtml, 'Y');
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/test_card.js" 2>&1 | grep -m1 "AssertionError"
node "$TMP/test_card_dados.js" 2>&1 | grep -m1 "TypeError\|AssertionError"
```
Expected: os dois falham (`jc-reduzido` ainda não existe; `montarDadosReduzido is not a function`).

- [ ] **Step 4: Nova versão de `jogadorCardHtml`**

Salvar o código abaixo como `TMP/jc_nova.js` e rodar o script de troca. O bloco a seguir **substitui a função inteira** `jogadorCardHtml` (as auxiliares acima dela, `jcIconeGoogle`, `jcFormatarEstrelas`, `jcFormatarMedia` e `jcMetricaHtml`, ficam como estão):

```javascript
function jogadorCardHtml(d, opcoes){
  const op = opcoes || {};
  const perfil = op.variante === 'perfil';
  const reduzido = op.variante === 'reduzido';
  const inicial = escapeHtml((d.apelido || d.nome || '?').charAt(0).toUpperCase());
  const foto = d.foto
    ? `<img class="jc-foto" src="${escapeHtml(d.foto)}" alt="">`
    : `<div class="jc-foto jc-foto-inicial">${inicial}</div>`;
  // o reduzido é o cartão das telas de time/listas: sem hexágono
  const hex = (!reduzido && d.posicao) ? `<div class="jc-hex" title="Posição no ranking do ano"><span>${d.posicao}</span></div>` : '';
  // o nome abre o perfil, exceto na variação 'perfil' (dentro do modal reabriria o próprio perfil) e onde quem
  // chama pede (Check-in e Sorteio: tocar na linha alterna o check-in/seleção, não pode abrir o perfil)
  const abrePerfil = op.nomeAbrePerfil != null ? op.nomeAbrePerfil : !perfil;
  // nomeHtml/apelidoHtml: HTML JÁ ESCAPADO por quem chama (o destaque da busca devolve <mark>)
  const nomeTxt = d.nomeHtml != null ? d.nomeHtml : escapeHtml(d.nome || '');
  const nome = `<span class="jc-nome"${abrePerfil ? ` data-open-profile="${escapeHtml(d.id)}"` : ''}>${nomeTxt}</span>`;

  const partesIcones = [];
  if(d.sexo === 'M') partesIcones.push('<i class="ti ti-gender-male jc-sexo jc-sexo-M" title="Masculino"></i>');
  if(d.sexo === 'F') partesIcones.push('<i class="ti ti-gender-female jc-sexo jc-sexo-F" title="Feminino"></i>');
  if(!reduzido && d.temConta) partesIcones.push(`<span class="jc-icone-conta" title="Jogador com conta cadastrada no app">${jcIconeGoogle()}</span>`);
  // no reduzido só sobra o símbolo de sexo: emblemas ficam de fora de propósito
  const iconesInterno = partesIcones.join('') + (reduzido ? '' : (d.emblemasHtml || ''));
  const icones = iconesInterno ? `<span class="jc-icones">${iconesInterno}</span>` : '';
  // reduzido: as estrelinhas ficam logo depois do nome/símbolo (uma linha só, que quebra em coluna estreita)
  const estrelasInline = (reduzido && d.estrelasHtml) ? `<span class="jc-estrelas">${d.estrelasHtml}</span>` : '';

  const apelidoTxt = d.apelidoHtml != null ? d.apelidoHtml : (d.apelido ? escapeHtml(d.apelido) : '');
  const apelido = apelidoTxt ? `<div class="jc-apelido">"${apelidoTxt}"</div>` : '';
  // estrelinhas de relance: a lista fechada não mostra a coluna "Estrelas"; no perfil com painel a coluna já mostra a nota
  const glifos = (!reduzido && d.estrelasHtml && (!perfil || !d.metricas)) ? d.estrelasHtml : '';
  // o sexo já aparece como símbolo ♂/♀ ao lado do nome (com o texto no tooltip), então não repete em pílula
  const tagsInterno = glifos + (d.ausenciaHtml || '') + (d.tagsExtraHtml || '');
  const tags = tagsInterno ? `<div class="jc-linha-tags">${tagsInterno}</div>` : '';

  const toggle = (!perfil && !reduzido && d.metricas)
    ? `<button type="button" class="jc-toggle" aria-expanded="${op.aberto ? 'true' : 'false'}" aria-label="Mostrar estatísticas" data-som="nav"><i class="ti ti-chevron-right"></i></button>`
    : '';
  const acoesInterno = (d.acoesHtml || '') + toggle;
  const acoes = acoesInterno ? `<div class="jc-acoes">${acoesInterno}</div>` : '';
  const leading = d.leadingHtml ? `<div class="jc-leading">${d.leadingHtml}</div>` : '';

  let painel = '';
  if(d.metricas && !reduzido){
    const m = d.metricas;
    // o número de Títulos só é clicável no perfil (abre as datas de campeão) — o id vem de quem chama
    const titulo = (perfil && op.tituloId)
      ? `<span class="jc-valor ranking-titulos-clicavel" id="${escapeHtml(op.tituloId)}" title="Toque para ver as datas">${m.titulos}</span>`
      : `<span class="jc-valor">${m.titulos}</span>`;
    const colunas = [
      jcMetricaHtml('ti-calendar', 'jc-cor-accent', 'Partidas', `<span class="jc-valor">${m.partidas}</span>`),
      jcMetricaHtml('ti-trophy', 'jc-cor-ouro', 'Títulos', titulo),
      jcMetricaHtml('ti-gauge', 'jc-cor-roxo', 'Aproveitamento', `<span class="jc-valor">${m.pct}%</span>`)
    ];
    // média de vitórias por partida (ex.: 93 vitórias em 19 partidas = 4,9). Sem "vitorias" (chamador antigo) a coluna não existe.
    if(m.vitorias != null && m.partidas > 0){
      colunas.push(jcMetricaHtml('ti-ball-volleyball', 'jc-cor-verde', 'Vit./partida',
        `<span class="jc-valor">${jcFormatarMedia(m.vitorias, m.partidas)}</span><span class="jc-sub">${m.vitorias} vit. em ${m.partidas} partidas</span>`));
    }
    // estrelas ocultas pelo admin (ou nota zero): a coluna some e as outras se redistribuem
    if(d.estrelas != null && d.estrelas > 0){
      colunas.push(jcMetricaHtml('ti-star', 'jc-cor-ouro', 'Estrelas', `<span class="jc-valor">${jcFormatarEstrelas(d.estrelas)}</span>`));
    }
    painel = `<div class="jc-painel"><div class="jc-painel-int"><div class="jc-metricas" style="--jc-cols:${colunas.length}">${colunas.join('')}</div></div></div>`;
  }

  const classes = ['jogador-card', perfil ? 'jc-perfil' : (reduzido ? 'jc-reduzido' : 'jc-lista')];
  if(op.classesExtra) classes.push(op.classesExtra); // ex.: 'draft-chip', pro cartão SER o chip arrastável do sorteio
  if(!perfil && !reduzido && op.aberto && d.metricas) classes.push('aberto');
  // "atributos" vem pronto e confiável de quem chama (ids do próprio app: draggable, data-player-id...)
  const atributos = op.atributos ? ' ' + op.atributos : '';
  return `<div class="${classes.join(' ')}" data-jc-id="${escapeHtml(d.id)}"${atributos}>
    <div class="jc-topo">
      ${leading}<div class="jc-avatar-bloco"><div class="jc-anel">${foto}</div>${hex}</div>
      <div class="jc-info">
        <div class="jc-linha-nome">${nome}${icones}${estrelasInline}</div>
        ${apelido}${tags}
      </div>
      ${acoes}
    </div>
    ${painel}
  </div>`;
}
```

Script de troca (`TMP/troca_jc.js`), que preserva CRLF:

```javascript
const fs = require('fs');
const f = 'c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS/volei-dashboard.html';
const nova = fs.readFileSync('C:/Users/Heleno/AppData/Local/Temp/claude/jc_nova.js', 'utf8');
let h = fs.readFileSync(f, 'utf8');
const crlf = h.includes('\r\n');
const ini = h.indexOf('function jogadorCardHtml(d, opcoes){');
const fim = h.indexOf('// </jogador-card-puro>');
if(ini < 0 || fim < 0 || fim < ini) throw new Error('âncoras não achadas');
const novaFmt = (crlf ? nova.replace(/\r?\n/g, '\r\n') : nova).replace(/\s+$/, '') + (crlf ? '\r\n' : '\n');
h = h.slice(0, ini) + novaFmt + h.slice(fim);
fs.writeFileSync(f, h);
console.log('jogadorCardHtml substituída');
```

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
node "$TMP/troca_jc.js"
```

- [ ] **Step 5: `montarDadosReduzido`**

Dentro do bloco `// <card-dados>` … `// </card-dados>`, logo **antes** de `// </card-dados>`, acrescentar:

```javascript
/* Versão BARATA de montarDadosCard, pro cartão reduzido (Check-in, Sorteio, Histórico, Nova Rodada):
   não calcula emblemas, ranking nem estatísticas — o reduzido não mostra nada disso. Serve também para
   convidados (GUESTS), que não têm foto nem estatísticas. */
function montarDadosReduzido(p, mostrarEstrelas, extras){
  const nota = parseFloat(p.estrelas);
  return Object.assign({
    id: p.id, nome: p.nome, apelido: p.apelido || '', foto: p.foto || '', sexo: p.sexo || '',
    // _estrelaAjustada só existe no sorteio: a estrela fica vermelha (nota ajustada só pra este check-in)
    estrelasHtml: (mostrarEstrelas && nota > 0) ? starsDisplay(p.estrelas, p._estrelaAjustada) : ''
  }, extras || {});
}
```

- [ ] **Step 6: CSS**

Inserir imediatamente antes de `</style>`:

```css
  /* ===== CARTÃO REDUZIDO (Check-in, Sorteio, Histórico, Nova Rodada) ===== */
  /* sem animação de entrada de propósito: essas listas re-renderizam inteiras a cada clique */
  .jogador-card.jc-reduzido{border-radius:12px;box-shadow:none;}
  .jc-reduzido .jc-topo{padding:8px 12px;gap:10px;}
  .jc-reduzido .jc-foto{width:38px;height:38px;}
  .jc-reduzido .jc-anel{padding:2px;box-shadow:0 0 10px color-mix(in srgb, var(--accent) 35%, transparent);}
  .jc-reduzido .jc-nome{font-size:14px;margin-right:6px;white-space:nowrap;}
  .jc-reduzido .jc-icones{padding-left:0;border-left:none;}
  .jc-reduzido .jc-linha-nome{gap:2px 0;}
  .jc-reduzido .jc-sexo{font-size:16px;}
  .jc-estrelas{display:inline-flex;align-items:center;margin-left:6px;}
  .jc-leading{flex:none;display:flex;align-items:center;}
  .jc-leading input[type=checkbox]{width:18px;height:18px;cursor:pointer;}
  /* <label> que envolve o cartão nas listas (Check-in/Sorteio): tocar em qualquer ponto aciona o botão/checkbox */
  .jc-linha{display:block;margin-bottom:8px;cursor:pointer;}
  /* cartão reduzido que também é o .draft-chip arrastável: a caixa do cartão manda, o padding/flex do chip antigo sai */
  .jogador-card.draft-chip{display:block;padding:0;margin-bottom:6px;cursor:grab;font-size:inherit;}
  .jogador-card.draft-chip:active{cursor:grabbing;}
  .history-team .jogador-card{margin-bottom:6px;}
  .picker-trigger .jogador-card{flex:1;min-width:0;}
  .picker-trigger:has(.jogador-card){padding:3px;}
```

- [ ] **Step 7: Rodar os testes e validar sintaxe**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/test_card.js" && node "$TMP/test_card_dados.js"
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.argv[1]+'/check_html.js',m[1]);" "$TMP" && node --check "$TMP/check_html.js" && echo "SINTAXE OK"
```
Expected: `OK — cartão do jogador`, `OK — dados do cartão`, `SINTAXE OK`. (Os testes antigos da variante `lista`/`perfil` continuam no mesmo arquivo e precisam seguir passando.)

- [ ] **Step 8: Commit**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
git add volei-dashboard.html
git commit -m "$(cat <<'EOF'
Cartão do jogador: variante reduzido e montarDadosReduzido (ainda sem uso)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Check-in e lista do Sorteio

**Files:**
- Modify: `volei-dashboard.html` — `renderCheckinList`, `renderSorteioList`

**Interfaces:**
- Consumes: `jogadorCardHtml`, `montarDadosReduzido` (Task 1); `highlightMatch(label, term)` (já existe, devolve HTML escapado com `<mark>`); `starsVisibleNow()`.

- [ ] **Step 1: Check-in**

Em `renderCheckinList`, trocar

```javascript
  const badges = computeBadges();
  const travado = SETTINGS.checkinTravado;
```

por

```javascript
  const mostrarEstrelas = starsVisibleNow();
  const travado = SETTINGS.checkinTravado;
```

e trocar o `return \`<label class="select-row" ...>...</label>\`;` do `.map` (o trecho abaixo, inteiro) 

```javascript
    return `<label class="select-row" style="cursor:pointer;" data-checkin-toggle="${p.id}">
      ${avatarHtml(p,'sm')}
      <span class="flex1">${nomeComApelidoHtml(p, term)}${badgeIconsHtml(p.id, badges)}${p.isGuest ? ' <span class="badge-guest">convidado</span>' : ''}</span>
      ${starsVisibleNow() ? starsDisplay(p.estrelas) : ''}
      ${p.sexo ? `<span class="badge-gender ${p.sexo}">${p.sexo}</span>` : ''}
      <button type="button" class="btn ${confirmado && !naReserva?'':'secondary'}" style="padding:6px 12px;font-size:12px;" data-checkin-btn="${p.id}" ${podeMarcar?'':'disabled'}>
        ${rotulo}
      </button>
    </label>`;
```

por

```javascript
    const botao = `<button type="button" class="btn ${confirmado && !naReserva?'':'secondary'}" style="padding:6px 12px;font-size:12px;" data-checkin-btn="${p.id}" ${podeMarcar?'':'disabled'}>
        ${rotulo}
      </button>`;
    // o <label> continua em volta: tocar em qualquer ponto da linha aciona o botão, como antes.
    // O nome NÃO abre o perfil aqui (tocar na linha é pra marcar presença).
    return `<label class="jc-linha" data-checkin-toggle="${p.id}">${jogadorCardHtml(
      montarDadosReduzido(p, mostrarEstrelas, {
        nomeHtml: highlightMatch(p.nome, term),
        apelidoHtml: p.apelido ? highlightMatch(p.apelido, term) : '',
        tagsExtraHtml: p.isGuest ? '<span class="badge-guest">convidado</span>' : '',
        acoesHtml: botao
      }),
      { variante: 'reduzido', nomeAbrePerfil: false }
    )}</label>`;
```

- [ ] **Step 2: Lista do Sorteio**

Em `renderSorteioList`, trocar

```javascript
  const badges = computeBadges();
  list.innerHTML = pool.map(p=>`
    <label class="select-row">
      <input type="checkbox" data-id="${p.id}" ${SELECTED_IDS.has(p.id) ? 'checked' : ''}>
      ${avatarHtml(p,'sm')}
      <span class="flex1">${nomeComApelidoHtml(p, term)}${badgeIconsHtml(p.id, badges)}${p.isGuest ? ' <span class="badge-guest">convidado</span>' : ''}</span>
      ${starsVisibleNow() ? starsDisplay(p.estrelas) : ''}
      ${p.sexo ? `<span class="badge-gender ${p.sexo}">${p.sexo}</span>` : ''}
    </label>
  `).join('');
```

por

```javascript
  const mostrarEstrelas = starsVisibleNow();
  // o checkbox vai no "leadingHtml" e o <label> envolve o cartão: tocar na linha alterna a seleção, como antes
  list.innerHTML = pool.map(p=>`<label class="jc-linha">${jogadorCardHtml(
    montarDadosReduzido(p, mostrarEstrelas, {
      nomeHtml: highlightMatch(p.nome, term),
      apelidoHtml: p.apelido ? highlightMatch(p.apelido, term) : '',
      tagsExtraHtml: p.isGuest ? '<span class="badge-guest">convidado</span>' : '',
      leadingHtml: `<input type="checkbox" data-id="${p.id}" ${SELECTED_IDS.has(p.id) ? 'checked' : ''}>`
    }),
    { variante: 'reduzido', nomeAbrePerfil: false }
  )}</label>`).join('');
```

- [ ] **Step 3: Sintaxe e testes**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/test_card.js" && node "$TMP/test_card_dados.js"
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.argv[1]+'/check_html.js',m[1]);" "$TMP" && node --check "$TMP/check_html.js" && echo "SINTAXE OK"
sed -n '/^function renderCheckinList/,/^}/p' volei-dashboard.html | grep -c "badges"
sed -n '/^function renderSorteioList/,/^}/p' volei-dashboard.html | grep -c "badges"
```
Expected: testes OK, `SINTAXE OK`, e os dois `grep -c` = `0` (nenhum resto de `badges` nessas funções).

- [ ] **Step 4: Verificação no navegador (Chrome sem interface, dados reais)**

Criar `TMP/…/scratchpad/verif_checkin_sorteio.js` com `puppeteer-core` (já instalado no scratchpad), abrindo `http://localhost:8000/volei-dashboard.html` com as miniaturas do Drive bloqueadas (`page.setRequestInterception`, abortar `drive.google.com/thumbnail`). Depois de `waitForSelector('.jogador-card')`:

```javascript
// Check-in: abre uma data e renderiza
await page.evaluate(()=>{ SETTINGS.checkinDataAberta = '2026-09-22'; document.querySelector('#nav button[data-view="checkin"]').click(); renderCheckinList(); });
const ci = await page.evaluate(()=>({
  cartoes: document.querySelectorAll('#checkin-list .jc-reduzido').length,
  labels: document.querySelectorAll('#checkin-list label[data-checkin-toggle]').length,
  botoes: document.querySelectorAll('#checkin-list [data-checkin-btn]').length,
  semHex: !document.querySelector('#checkin-list .jc-hex'),
  semEmblemas: !document.querySelector('#checkin-list .badge-icon'),
  nomeSemPerfil: !document.querySelector('#checkin-list [data-open-profile]'),
  semLetraMF: !document.querySelector('#checkin-list .badge-gender'),
  esperados: DATA.players.length + GUESTS.length
}));
// Busca com destaque
await page.evaluate(()=>{ const s=document.getElementById('checkin-search'); s.value='ar'; renderCheckinList(); });
const busca = await page.evaluate(()=>({ marcas: document.querySelectorAll('#checkin-list mark.picker-match').length, cartoes: document.querySelectorAll('#checkin-list .jc-reduzido').length }));
await page.evaluate(()=>{ document.getElementById('checkin-search').value=''; renderCheckinList(); });
// Clique na LINHA aciona o botão (label + button), uma única vez
const cliques = await page.evaluate(()=>{
  const btn = document.querySelector('#checkin-list [data-checkin-btn]'); let n = 0; btn.addEventListener('click', e=>{ n++; e.preventDefault(); e.stopImmediatePropagation(); }, true);
  document.querySelector('#checkin-list .jogador-card .jc-info').click();   // clica no MEIO do cartão, fora do botão
  return n;
});
// Estrelas visíveis / ocultas
const est = await page.evaluate(()=>{ SETTINGS.estrelasVisiveis = true; renderCheckinList(); const v = document.querySelectorAll('#checkin-list .jc-estrelas').length;
  SETTINGS.estrelasVisiveis = false; renderCheckinList(); const o = document.querySelectorAll('#checkin-list .jc-estrelas').length; return { visiveis:v, ocultas:o }; });
// Sorteio: lista com checkbox
await page.evaluate(()=>{ document.querySelector('#nav button[data-view="sorteio"]').click(); renderSorteioList(); });
const so = await page.evaluate(()=>{
  const cbs = document.querySelectorAll('#sorteio-select-list input[type=checkbox][data-id]');
  const antes = SELECTED_IDS.size; cbs[0].closest('label').querySelector('.jc-info').click();   // clique na linha
  return { cartoes: document.querySelectorAll('#sorteio-select-list .jc-reduzido').length, checkboxes: cbs.length, selecionadosAntes: antes, selecionadosDepois: SELECTED_IDS.size, semPerfil: !document.querySelector('#sorteio-select-list [data-open-profile]') };
});
```
Esperado: `cartoes === labels === botoes === esperados`; `semHex`, `semEmblemas`, `nomeSemPerfil`, `semLetraMF` = `true`; `busca.marcas > 0`; `cliques === 1`; `est.visiveis > 0` e `est.ocultas === 0`; no Sorteio `checkboxes === cartoes`, `selecionadosDepois === selecionadosAntes + 1` e `semPerfil === true`. Nenhum `pageerror`. Tirar screenshots de `#checkin-list` e `#sorteio-select-list` (escuro e claro) e conferir visualmente.

- [ ] **Step 5: Commit**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
git add volei-dashboard.html
git commit -m "$(cat <<'EOF'
Check-in e lista do Sorteio com o cartão reduzido

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Grupos e times sorteados (chips arrastáveis)

**Files:**
- Modify: `volei-dashboard.html` — `renderGroupsInto`, `renderDraftResult`

- [ ] **Step 1: Grupos**

Em `renderGroupsInto`, trocar

```javascript
  const container = document.getElementById(containerId);
  const badges = computeBadges();
  container.innerHTML = grupos.map((grupo, gi)=>{
```

por

```javascript
  const container = document.getElementById(containerId);
  const mostrarEstrelas = starsVisibleNow();
  container.innerHTML = grupos.map((grupo, gi)=>{
```

e trocar o `grupo.map(p=>\`...\`)` do chip:

```javascript
grupo.map(p=>`
          <div class="draft-chip" draggable="true" data-player-id="${p.id}" data-from-group="${gi}">
            ${avatarHtml(p,'sm')}
            <span class="flex1 clickable-name" data-open-profile="${p.id}">${nomeComApelidoHtml(p)}${badgeIconsHtml(p.id, badges)}</span>
            ${starsVisibleNow() ? starsDisplay(p.estrelas, p._estrelaAjustada) : ''}
            ${p.isGuest ? '<span class="badge-guest">convidado</span>' : ''}
            ${p.sexo ? `<span class="badge-gender ${p.sexo}">${p.sexo}</span>` : ''}
          </div>
        `).join('')
```

por

```javascript
grupo.map(p=> jogadorCardHtml(
          montarDadosReduzido(p, mostrarEstrelas, { tagsExtraHtml: p.isGuest ? '<span class="badge-guest">convidado</span>' : '' }),
          // o cartão É o .draft-chip: mesma classe e mesmos data-* que wireGroupDragAndDrop espera
          { variante: 'reduzido', classesExtra: 'draft-chip', atributos: `draggable="true" data-player-id="${p.id}" data-from-group="${gi}"` }
        )).join('')
```

- [ ] **Step 2: Times sorteados**

Em `renderDraftResult`, trocar

```javascript
  const grid = document.getElementById('draft-grid');
  const badges = computeBadges();
```

por

```javascript
  const grid = document.getElementById('draft-grid');
  const mostrarEstrelas = starsVisibleNow();
```

e trocar o `ordemExibicao.map(p=>\`...\`)`:

```javascript
ordemExibicao.map(p=>`
          <div class="draft-chip" draggable="true" data-player-id="${p.id}" data-from-team="${ti}">
            ${avatarHtml(p,'sm')}
            <span class="flex1 clickable-name" data-open-profile="${p.id}">${nomeComApelidoHtml(p)}${badgeIconsHtml(p.id, badges)}</span>
            ${starsVisibleNow() ? starsDisplay(p.estrelas, p._estrelaAjustada) : ''}
            ${p.isGuest ? '<span class="badge-guest">convidado</span>' : ''}
            ${p.sexo ? `<span class="badge-gender ${p.sexo}">${p.sexo}</span>` : ''}
          </div>
        `).join('')
```

por

```javascript
ordemExibicao.map(p=> jogadorCardHtml(
          montarDadosReduzido(p, mostrarEstrelas, { tagsExtraHtml: p.isGuest ? '<span class="badge-guest">convidado</span>' : '' }),
          { variante: 'reduzido', classesExtra: 'draft-chip', atributos: `draggable="true" data-player-id="${p.id}" data-from-team="${ti}"` }
        )).join('')
```

- [ ] **Step 3: Sintaxe e conferência de restos**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.argv[1]+'/check_html.js',m[1]);" "$TMP" && node --check "$TMP/check_html.js" && echo "SINTAXE OK"
sed -n '/^function renderGroupsInto/,/^}/p' volei-dashboard.html | grep -c "badges"
sed -n '/^function renderDraftResult/,/^}/p' volei-dashboard.html | grep -c "badges"
```
Expected: `SINTAXE OK` e os dois `grep -c` = `0`.

- [ ] **Step 4: Verificação no navegador (inclui arrastar de verdade)**

`TMP/…/scratchpad/verif_draft.js`, mesma base da Task 2. Montar o estado sem depender do botão de sortear:

```javascript
await page.evaluate(()=>{
  const ps = DATA.players.slice(0, 8);
  DRAFT_TEAMS = [ps.slice(0,4), ps.slice(4,8)];
  document.querySelector('#nav button[data-view="sorteio"]').click();
  renderDraftResult(); wireDragAndDrop();
});
const antes = await page.evaluate(()=>({ time0: DRAFT_TEAMS[0].length, time1: DRAFT_TEAMS[1].length, chips: document.querySelectorAll('#draft-grid .draft-chip.jogador-card').length,
  semHex: !document.querySelector('#draft-grid .jc-hex'), semEmblemas: !document.querySelector('#draft-grid .badge-icon'), semLetraMF: !document.querySelector('#draft-grid .badge-gender') }));
// arrasta o 1º chip do time 0 para a zona do time 1, com DragEvent de verdade
await page.evaluate(()=>{
  const chip = document.querySelector('#draft-grid .draft-chip[data-from-team="0"]');
  const zona = document.querySelector('#draft-grid .draft-players[data-team-index="1"]');
  const dt = new DataTransfer();
  chip.dispatchEvent(new DragEvent('dragstart', { bubbles:true, dataTransfer:dt }));
  zona.dispatchEvent(new DragEvent('dragover', { bubbles:true, cancelable:true, dataTransfer:dt }));
  zona.dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer:dt }));
});
const depois = await page.evaluate(()=>({ time0: DRAFT_TEAMS[0].length, time1: DRAFT_TEAMS[1].length, chips: document.querySelectorAll('#draft-grid .draft-chip.jogador-card').length,
  arrastavel: [...document.querySelectorAll('#draft-grid .draft-chip')].every(c=>c.getAttribute('draggable')==='true') }));
// Grupos
await page.evaluate(()=>{ MANUAL_GROUPS.length = 0; MANUAL_GROUPS.push(DATA.players.slice(0,3), DATA.players.slice(3,5)); renderManualGroups(); });
await page.evaluate(()=>{
  const chip = document.querySelector('#manual-groups .draft-chip[data-from-group="0"]'); const zona = document.querySelector('#manual-groups .draft-players[data-group-index="1"]'); const dt = new DataTransfer();
  chip.dispatchEvent(new DragEvent('dragstart', { bubbles:true, dataTransfer:dt })); zona.dispatchEvent(new DragEvent('dragover', { bubbles:true, cancelable:true, dataTransfer:dt })); zona.dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer:dt }));
});
const grupos = await page.evaluate(()=>({ g0: MANUAL_GROUPS[0].length, g1: MANUAL_GROUPS[1].length }));
```
Esperado: `antes.time0===4 && antes.time1===4`, `semHex/semEmblemas/semLetraMF` `true`; depois do arrastar `time0===3 && time1===5`, `chips` inalterado (8) e `arrastavel` `true`; `grupos.g0===2 && grupos.g1===3`. Sem `pageerror`. Screenshot de `#draft-grid` (escuro/claro/390px) e conferir a aparência.

- [ ] **Step 5: Commit**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
git add volei-dashboard.html
git commit -m "$(cat <<'EOF'
Sorteio: grupos e times sorteados com o cartão reduzido arrastável

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Histórico, Nova Rodada e versão 9.0

**Files:**
- Modify: `volei-dashboard.html` — `renderHistory` (2 pontos), `renderRodadaGuestChips`, `playerTriggerHtml`, rodapé, `#info-changelog`

O mesmo trecho `<div class="with-avatar" ...>` aparece em `renderAoVivo`, `renderDashboard` e `renderHistory`; as trocas abaixo devem ser feitas **só dentro de `renderHistory`** (o Ao Vivo e o Início são Fase 2). Usar um script que recorte a função:

- [ ] **Step 1: Histórico**

Salvar como `TMP/troca_historico.js`:

```javascript
const fs = require('fs');
const f = 'c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS/volei-dashboard.html';
let h = fs.readFileSync(f, 'utf8');
const crlf = h.includes('\r\n');
const fmt = s => crlf ? s.replace(/\r?\n/g, '\r\n') : s;
const ini = h.indexOf('function renderHistory(');
if(ini < 0) throw new Error('renderHistory não achada');
const fim = h.indexOf('\nfunction ', ini + 10);
let corpo = h.slice(ini, fim);
function troca(de, para){
  const n = corpo.split(de).length - 1;
  if(n !== 1) throw new Error(n + ' ocorrências de: ' + de.slice(0, 80));
  corpo = corpo.replace(de, () => para);
}
// 1) rascunhos: nome sem clique (como hoje)
troca("${t.playerIds.map(pid=>{ const p=getPlayer(pid); return `<div class=\"with-avatar\" style=\"margin-bottom:4px;\">${avatarHtml(p,'sm')}<span>${p?nomeComApelidoHtml(p):'(removido)'}</span></div>`; }).join('') ||",
      "${t.playerIds.map(pid=>{ const p=getPlayer(pid); return p ? jogadorCardHtml(montarDadosReduzido(p, mostrarEstrelas), { variante: 'reduzido', nomeAbrePerfil: false }) : '<div style=\"color:var(--muted);font-size:12px;margin-bottom:4px;\">(removido)</div>'; }).join('') ||");
// 2) rodadas oficiais: o nome abre o perfil, como hoje (clickable-name)
troca("${t.playerIds.map(pid=>{ const p=getPlayer(pid); return `<div class=\"with-avatar\" style=\"margin-bottom:4px;\">${avatarHtml(p,'sm')}<span class=\"clickable-name\" data-open-profile=\"${pid}\">${p?nomeComApelidoHtml(p):'(removido)'}</span>${badgeIconsHtml(pid, badges)}</div>`; }).join('')}",
      "${t.playerIds.map(pid=>{ const p=getPlayer(pid); return p ? jogadorCardHtml(montarDadosReduzido(p, mostrarEstrelas), { variante: 'reduzido' }) : '<div style=\"color:var(--muted);font-size:12px;margin-bottom:4px;\">(removido)</div>'; }).join('')}");
// 3) o cartão reduzido não usa emblemas: troca o cálculo caro pelo que ele precisa
troca("const badges = computeBadges();", "const mostrarEstrelas = starsVisibleNow(); // o cartão reduzido só precisa saber se pode mostrar as estrelas");
h = h.slice(0, ini) + corpo + h.slice(fim);
fs.writeFileSync(f, h);
console.log('renderHistory atualizada');
```

```bash
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/troca_historico.js"
```
Se o script acusar `0 ocorrências` ou `2 ocorrências`, **parar**, ler o trecho real de `renderHistory` e ajustar o texto de busca (não forçar).

- [ ] **Step 2: Convidados e jogador do slot (Nova Rodada)**

Em `renderRodadaGuestChips`, trocar

```javascript
  container.innerHTML = GUESTS.map(g=>`
    <span class="chip with-avatar">${avatarHtml(g,'sm')}<span class="clickable-name" data-open-profile="${g.id}">${escapeHtml(g.nome)}</span>${starsVisibleNow() ? starsDisplay(g.estrelas) : ''}<span class="badge-guest" style="margin-left:6px;">convidado</span>
      <button type="button" class="icon-btn" data-remove-guest="${g.id}" style="margin-left:4px;" title="Remover convidado">✕</button>
    </span>`).join('');
```

por

```javascript
  const mostrarEstrelas = starsVisibleNow();
  container.innerHTML = GUESTS.map(g=> jogadorCardHtml(
    montarDadosReduzido(g, mostrarEstrelas, {
      tagsExtraHtml: '<span class="badge-guest">convidado</span>',
      acoesHtml: `<button type="button" class="icon-btn" data-remove-guest="${g.id}" title="Remover convidado">✕</button>`
    }),
    { variante: 'reduzido' }
  )).join('');
```

e trocar `playerTriggerHtml`:

```javascript
function playerTriggerHtml(p){
  if(!p) return '<span class="picker-placeholder">🔍 Escolher jogador…</span>';
  return `${avatarHtml(p,'sm')}<span>${nomeComApelidoHtml(p)}${badgeIconsHtml(p.id, computeBadges())}</span>`;
}
```

por

```javascript
function playerTriggerHtml(p){
  if(!p) return '<span class="picker-placeholder">🔍 Escolher jogador…</span>';
  // dentro do botão do slot: tocar no nome tem que abrir o seletor, não o perfil
  return jogadorCardHtml(montarDadosReduzido(p, starsVisibleNow()), { variante: 'reduzido', nomeAbrePerfil: false });
}
```

Conferir o container dos convidados: `grep -n "rodada-guest-chips" volei-dashboard.html`. Se ele for um `display:flex` em linha, acrescentar ao CSS do fim: `#rodada-guest-chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;}`.

- [ ] **Step 3: Versão e Log de Alterações**

Rodapé `Ver.: 8.9 ·` → `Ver.: 9.0 ·`. Em `#info-changelog`, inserir **antes** da entrada v8.9 uma nova com `open` e **remover** o `open` da v8.9:

```html
        <details class="dash-accordion" open>
          <summary>19/09/2026 — v9.0: Cartão do jogador nas listas e times</summary>
          <div>
            <p style="line-height:1.6;">O cartão do jogador agora aparece também no <strong>Check-in</strong>, no <strong>Sorteio</strong> (lista, grupos e times sorteados), no <strong>Histórico de rodadas</strong> e na <strong>Nova Rodada</strong>, numa versão reduzida: só o símbolo ♂/♀ e as estrelinhas (para quem pode vê-las), sem hexágono nem emblemas.</p>
            <p style="line-height:1.6;">Marcar presença, selecionar para o sorteio e arrastar jogadores entre times funcionam como antes.</p>
          </div>
        </details>

        <details class="dash-accordion">
          <summary>19/09/2026 — v8.9: Estrela dourada</summary>
```

- [ ] **Step 4: Testes, sintaxe e restos**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
SP="$TMP/c--Users-Heleno-OneDrive-Documentos-GitHub-voleis-VS/18a97619-5c6e-4fd5-843b-2fe350637e40/scratchpad"
node "$TMP/test_card.js" && node "$TMP/test_card_dados.js" && node "$SP/test_som.js" && node "$SP/test_podio.js" && node "$SP/test_radar.js"
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.argv[1]+'/check_html.js',m[1]);" "$TMP" && node --check "$TMP/check_html.js" && echo "SINTAXE OK"
sed -n '/^function renderHistory/,/^function /p' volei-dashboard.html | grep -c "badges\|badgeIconsHtml"
grep -o "Ver\.: [0-9.]*" volei-dashboard.html
```
Expected: 5 linhas `OK — ...`, `SINTAXE OK`, o `grep -c` de `renderHistory` = `0` (a função seguinte pode aparecer na contagem se ainda usar badges; conferir manualmente o trecho) e `Ver.: 9.0`.

- [ ] **Step 5: Verificação no navegador**

`TMP/…/scratchpad/verif_historico_novarodada.js`:

```javascript
// Histórico
await page.evaluate(()=>{ document.querySelector('#nav button[data-view="historico"]').click(); renderHistory(); });
const hi = await page.evaluate(()=>({
  cartoes: document.querySelectorAll('#view-historico .jc-reduzido').length,
  semHex: !document.querySelector('#view-historico .jc-hex'), semEmblemas: !document.querySelector('#view-historico .badge-icon'),
  nomesAbremPerfil: document.querySelectorAll('#view-historico .jc-nome[data-open-profile]').length,
  rodadas: document.querySelectorAll('#view-historico .history-teams').length }));
// clicar num nome do histórico abre o modal de perfil
await page.evaluate(()=> document.querySelector('#view-historico .jc-nome[data-open-profile]').click());
const perfilAbriu = await page.evaluate(()=> !!document.getElementById('profile-overlay'));
await page.evaluate(()=> closePlayerProfile());
// Nova Rodada: slot com jogador e convidado
await page.evaluate(()=>{ document.querySelector('#nav button[data-view="rodada"]').click();
  GUESTS.push({ id:'g_teste', nome:'Convidado Teste', estrelas:3, sexo:'M', isGuest:true }); renderRodadaGuestChips(); });
const nr = await page.evaluate(()=>({ convidados: document.querySelectorAll('#rodada-guest-chips .jc-reduzido').length,
  removerBtn: !!document.querySelector('#rodada-guest-chips [data-remove-guest="g_teste"]'),
  trigger: (()=>{ const t=document.querySelector('.picker-trigger'); t.innerHTML = playerTriggerHtml(DATA.players[0]); return { cartao: !!t.querySelector('.jogador-card'), nomeSemPerfil: !t.querySelector('[data-open-profile]') }; })() }));
await page.evaluate(()=> document.querySelector('#rodada-guest-chips [data-remove-guest="g_teste"]').click());
const removeu = await page.evaluate(()=> GUESTS.every(g=>g.id!=='g_teste'));
```
Esperado: `hi.cartoes > 0`, `semHex` e `semEmblemas` `true`, `hi.nomesAbremPerfil > 0`, `perfilAbriu === true`, `nr.convidados === 1`, `nr.removerBtn === true`, `nr.trigger.cartao === true`, `nr.trigger.nomeSemPerfil === true`, `removeu === true`; sem `pageerror`; e `document.documentElement.scrollWidth === clientWidth` em 390px nas 5 telas. Screenshots do histórico (escuro/claro/390px), do slot e dos convidados.

- [ ] **Step 6: Commit**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
git add volei-dashboard.html
git commit -m "$(cat <<'EOF'
Histórico e Nova Rodada com o cartão reduzido (v9.0)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Depois deste plano

Conforme o CLAUDE.md: **parar aqui** e mostrar o resultado só no Terça. O Meme só recebe o cartão reduzido depois de autorização explícita, pelo merge de 3 vias (base = Terça antes da Fase 1; versões LF via `git show`), como nas réplicas anteriores. Sem mudança de backend.

**Fase 2** (spec próprio, depois): Ranking, Hall da Fama, Top 10 de fotos, Duplas, Panelas, Defuntos, Início e Ao Vivo com o cartão completo, cada tela com seu mini-desenho.
