# Placar Ao Vivo — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma página "Ao Vivo" ao `volei-dashboard.html` que transmite rodadas com placar ainda não lançado (rascunhos), com controle de vitórias por organizador/admin, cronômetro regressivo e log de mudanças de placar, tudo espelhado em duas abas novas da planilha (`AoVivo` e `AoVivoLog`).

**Architecture:** CRUD simples sobre duas abas novas da planilha, seguindo exatamente os padrões já usados em `Rodadas`/`Checkins` (append/find-by-id/delete). O frontend reaproveita ao máximo o que já existe — grid de times do Histórico, tela de edição de rodada — e adiciona uma página nova com polling (POST, não GET, por causa de cache) pra manter quem só assiste atualizado. O cronômetro é calculado inteiramente no navegador a partir de dois timestamps, sem custo de rede.

**Tech Stack:** HTML+CSS+JS vanilla num arquivo só (`volei-dashboard.html`), backend em Google Apps Script (`apps-script-codigo.gs`), Google Sheets como banco de dados.

**Spec:** `docs/superpowers/specs/2026-09-17-placar-ao-vivo-design.md`

## Global Constraints

- Implementar e validar **só no Terça** (`volei-dashboard.html` + `apps-script-codigo.gs`). Nenhuma mudança no Meme (`volei-meme-dashboard.html` / `apps-script-codigo-volei-meme.gs`) até autorização explícita depois deste plano estar completo e validado.
- Toda mudança em JS precisa passar por `node --check` antes de ser considerada pronta (comando exato na seção "Validação" de cada task).
- Gravações sensíveis (iniciar/salvar parcial/cancelar transmissão) exigem organizador/admin, pelo mesmo `autorizar_`/`requireAuth` já usado no resto do app — nunca pular esse porteiro.
- `lerAoVivo` é a única ação nova pública (sem senha/login), e tem que ser **POST**, nunca GET — GET pode ficar em cache e essa ação precisa de dado sempre fresco a cada poll.
- Todas as gravações nas abas novas passam pelo `LockService` já usado em toda gravação sensível do projeto.
- Comentários em português explicando o *porquê*; nomes de função em português quando fazem sentido de domínio, seguindo o restante do arquivo.
- Ao final, subir a versão do rodapé (`Ver.: X.X`) e registrar uma entrada no Log de Alterações (`#info-changelog`) — só no Terça.

---

## Task 1: Planilha nova — leitura e utilitários no backend

**Files:**
- Modify: `apps-script-codigo.gs:1-19` (comentário de cabeçalho, lista de abas)
- Modify: `apps-script-codigo.gs` (novas funções, logo depois de `readRounds`/`writeRounds`, por volta da linha 425)

**Interfaces:**
- Produces: `readAoVivo(sheet)` → `Array<{id, data, iniciadoEm, duracaoMinutos, times: Array<{nome, playerIds, vitorias}>}>` (times indexado por `timeIndex`, mesmo formato de `readRounds`).
- Produces: `readAoVivoLog(sheet, roundIds)` → `Array<{roundId, timeIndex, timeNome, delta, timestamp}>`, mais recente primeiro.
- Produces: `acharLinhasPorRoundId_(sheet, roundId)` → `Array<number>` (números de linha 1-based que pertencem a essa rodada, na coluna A).
- Produces: `apagarLinhasDaRodadaAoVivo_(roundId)` → sem retorno; apaga as linhas dessa rodada em `AoVivo` e `AoVivoLog`.

- [ ] **Step 1: Atualizar o comentário de cabeçalho do `.gs`**

Em `apps-script-codigo.gs`, no comentário que hoje diz "A planilha precisa ter CINCO abas" (linhas 1-19), trocar `CINCO` por `SETE` e acrescentar as duas linhas novas depois da linha de `"Usuarios"`:

```
 *   - "AoVivo"      com cabeçalho na linha 1: roundId | data | timeIndex | timeNome | jogadores | vitorias | iniciadoEm | duracaoMinutos
 *                  (espelho de uma rodada em transmissão — criada e limpa pelo próprio
 *                  app; nunca editar essa aba manualmente)
 *   - "AoVivoLog"   com cabeçalho na linha 1: roundId | timeIndex | timeNome | delta | timestamp
 *                  (histórico de mudanças de placar de uma transmissão em andamento —
 *                  apagado junto quando a transmissão termina; não é histórico permanente)
```

- [ ] **Step 2: Escrever `readAoVivo`, `readAoVivoLog` e os utilitários de linha**

Inserir depois da função `readRounds` (depois da linha 425, antes de `function writePlayers`):

```javascript
function readAoVivo(sheet) {
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const [roundId, data, timeIndex, timeNome, jogadores, vitorias, iniciadoEm, duracaoMinutos] = rows[i];
    if (!roundId) continue;
    const rid = String(roundId);
    const dataStr = (data instanceof Date)
      ? Utilities.formatDate(data, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(data);
    if (!map[rid]) {
      map[rid] = { id: rid, data: dataStr, iniciadoEm: String(iniciadoEm || ''), duracaoMinutos: Number(duracaoMinutos) || 0, times: [] };
    }
    map[rid].times[Number(timeIndex)] = {
      nome: String(timeNome || ''),
      playerIds: jogadores ? String(jogadores).split(',').filter(Boolean) : [],
      vitorias: Number(vitorias) || 0
    };
  }
  return Object.values(map);
}

// Uma rodada ao vivo ocupa uma linha por time na aba (mesmo padrão de "Rodadas") —
// essa função acha todas as linhas de uma rodada específica pra apagar/atualizar juntas.
function acharLinhasPorRoundId_(sheet, roundId) {
  const valores = sheet.getDataRange().getValues();
  const linhas = [];
  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][0]) === String(roundId)) linhas.push(i + 1);
  }
  return linhas;
}

// Usada tanto por "Cancelar transmissão" quanto depois de um "Lançar placar final"
// bem-sucedido — as duas situações terminam a transmissão da mesma forma: limpando
// o rastro dela em AoVivo/AoVivoLog. A diferença entre as duas fica só no que
// acontece (ou não) na aba "Rodadas", decidida por quem chama esta função.
function apagarLinhasDaRodadaAoVivo_(roundId) {
  const sheetAoVivo = ss_().getSheetByName('AoVivo');
  const sheetLog = ss_().getSheetByName('AoVivoLog');
  [sheetAoVivo, sheetLog].forEach(function (sheet) {
    if (!sheet) return;
    acharLinhasPorRoundId_(sheet, roundId).sort(function (a, b) { return b - a; }).forEach(function (linha) {
      sheet.deleteRow(linha);
    });
  });
}

function readAoVivoLog(sheet, roundIds) {
  if (!sheet) return [];
  const idsValidos = new Set(roundIds.map(String));
  const rows = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const [roundId, timeIndex, timeNome, delta, timestamp] = rows[i];
    if (!roundId || !idsValidos.has(String(roundId))) continue;
    out.push({
      roundId: String(roundId), timeIndex: Number(timeIndex), timeNome: String(timeNome || ''),
      delta: Number(delta) || 0, timestamp: String(timestamp || '')
    });
  }
  out.sort(function (a, b) { return a.timestamp < b.timestamp ? 1 : -1; }); // mais recente primeiro
  return out;
}
```

- [ ] **Step 3: Validar sintaxe**

Run: `node --check apps-script-codigo.gs`
Expected: sem saída (sucesso silencioso).

- [ ] **Step 4: Commit**

```bash
git add apps-script-codigo.gs
git commit -m "Placar Ao Vivo: leitura das abas AoVivo/AoVivoLog no backend"
```

---

## Task 2: Ações do backend (iniciar, salvar parcial, cancelar, ler) + permissões

**Files:**
- Modify: `apps-script-codigo.gs:469-487` (`PERMISSOES`)
- Modify: `apps-script-codigo.gs` (novas funções de ação, logo depois dos utilitários do Task 1)
- Modify: `apps-script-codigo.gs:42-53` (`doGet`)
- Modify: `apps-script-codigo.gs:55-171` (`doPost`)

**Interfaces:**
- Consumes: `readAoVivo`, `readAoVivoLog`, `acharLinhasPorRoundId_`, `apagarLinhasDaRodadaAoVivo_` (Task 1); `readRounds`, `ss_()`, `jsonOut()`, `LockService` (já existentes).
- Produces: `iniciarTransmissaoAoVivo(roundId, duracaoMinutos)` → `{status:'ok'}` ou `{error}`.
- Produces: `salvarParcialAoVivo(roundId, vitoriasPorTime)` → `{status:'ok'}` ou `{error}` (`vitoriasPorTime` é um array indexado por `timeIndex`).
- Produces: `cancelarTransmissaoAoVivo(roundId)` → `{status:'ok'}`.
- Produces: `lerAoVivo()` → `{rounds: [...], log: [...]}` (mesmo formato de `readAoVivo`/`readAoVivoLog`).

- [ ] **Step 1: Escrever as quatro funções de ação**

Inserir logo depois de `apagarLinhasDaRodadaAoVivo_` (Task 1):

```javascript
function iniciarTransmissaoAoVivo(roundId, duracaoMinutos) {
  const round = readRounds(ss_().getSheetByName('Rodadas')).find(function (r) { return r.id === String(roundId); });
  if (!round) return { error: 'Rodada não encontrada (pode já ter sido removida).' };
  if (!round.rascunho) return { error: 'Essa rodada já teve o placar lançado — não é mais um rascunho.' };
  const sheetAoVivo = ss_().getSheetByName('AoVivo');
  if (!sheetAoVivo) return { error: 'Aba "AoVivo" não encontrada na planilha.' };
  if (acharLinhasPorRoundId_(sheetAoVivo, roundId).length > 0) {
    return { error: 'Essa rodada já está sendo transmitida ao vivo.' };
  }
  const agora = new Date().toISOString();
  sheetAoVivo.getRange('B:B').setNumberFormat('@'); // mesma proteção contra data virar objeto Data
  round.times.forEach(function (t, idx) {
    sheetAoVivo.appendRow([round.id, round.data, idx, t.nome, (t.playerIds || []).join(','), t.vitorias || 0, agora, Number(duracaoMinutos) || 0]);
  });
  return { status: 'ok' };
}

function salvarParcialAoVivo(roundId, vitoriasPorTime) {
  const sheetAoVivo = ss_().getSheetByName('AoVivo');
  if (!sheetAoVivo) return { error: 'Aba "AoVivo" não encontrada na planilha.' };
  const linhas = acharLinhasPorRoundId_(sheetAoVivo, roundId);
  if (linhas.length === 0) return { error: 'Essa transmissão não foi encontrada (pode já ter sido encerrada).' };
  const sheetLog = ss_().getSheetByName('AoVivoLog');
  const agora = new Date().toISOString();
  linhas.forEach(function (linha) {
    const valores = sheetAoVivo.getRange(linha, 1, 1, 8).getValues()[0];
    const timeIndex = Number(valores[2]);
    const timeNome = String(valores[3] || '');
    const vitoriasAtual = Number(valores[5]) || 0;
    const vitoriasNova = Number(vitoriasPorTime[timeIndex]);
    if (!Number.isFinite(vitoriasNova) || vitoriasNova === vitoriasAtual) return; // nada mudou pra esse time
    const delta = vitoriasNova - vitoriasAtual;
    if (sheetLog) sheetLog.appendRow([roundId, timeIndex, timeNome, delta, agora]);
    sheetAoVivo.getRange(linha, 6).setValue(vitoriasNova);
  });
  return { status: 'ok' };
}

function cancelarTransmissaoAoVivo(roundId) {
  apagarLinhasDaRodadaAoVivo_(roundId);
  return { status: 'ok' };
}

function lerAoVivo() {
  const rounds = readAoVivo(ss_().getSheetByName('AoVivo'));
  const log = readAoVivoLog(ss_().getSheetByName('AoVivoLog'), rounds.map(function (r) { return r.id; }));
  return { rounds: rounds, log: log };
}
```

- [ ] **Step 2: Adicionar as três ações autenticadas em `PERMISSOES`**

Em `apps-script-codigo.gs:469-487`, depois da linha `updateRound: ['organizador', 'admin'],`:

```javascript
  iniciarTransmissaoAoVivo: ['organizador', 'admin'],
  salvarParcialAoVivo:      ['organizador', 'admin'],
  cancelarTransmissaoAoVivo:['organizador', 'admin'],
```

- [ ] **Step 3: Ligar `lerAoVivo` como ação pública, fora do porteiro**

Em `doPost` (`apps-script-codigo.gs`), logo depois do bloco `if (body.action === 'incrementarAcesso') { ... }` (linhas 78-86) e antes do bloco de `loginGoogle`, adicionar:

```javascript
    // leitura pública do placar ao vivo — sem senha/login, igual à visualização do
    // resto do app. Só existe via POST (nunca GET) porque essa é uma ação chamada
    // em polling e precisa de dado sempre fresco, sem risco de cache.
    if (body.action === 'lerAoVivo') {
      return jsonOut(lerAoVivo());
    }
```

- [ ] **Step 4: Adicionar os três `case` autenticados no switch de `doPost`**

Em `apps-script-codigo.gs`, dentro do `switch (body.action)`, logo depois de `case 'updateRound': return jsonOut(updateRound(body.round));`:

```javascript
        case 'iniciarTransmissaoAoVivo':
          return jsonOut(iniciarTransmissaoAoVivo(body.roundId, body.duracaoMinutos));
        case 'salvarParcialAoVivo':
          return jsonOut(salvarParcialAoVivo(body.roundId, body.vitoriasPorTime));
        case 'cancelarTransmissaoAoVivo':
          return jsonOut(cancelarTransmissaoAoVivo(body.roundId));
```

- [ ] **Step 5: Incluir `aoVivo` no payload do `doGet`**

Em `apps-script-codigo.gs:42-53`, trocar:

```javascript
    const perfisPublicos = perfisPublicos_();
    return jsonOut({ players, rounds, settings, checkins, perfisPublicos });
```

por:

```javascript
    const perfisPublicos = perfisPublicos_();
    const aoVivo = lerAoVivo();
    return jsonOut({ players, rounds, settings, checkins, perfisPublicos, aoVivo });
```

- [ ] **Step 6: Validar sintaxe**

Run: `node --check apps-script-codigo.gs`
Expected: sem saída (sucesso silencioso).

- [ ] **Step 7: Commit**

```bash
git add apps-script-codigo.gs
git commit -m "Placar Ao Vivo: ações de iniciar/salvar parcial/cancelar/ler no backend"
```

---

## Task 3: Estrutura da página "Ao Vivo" no frontend (nav, HTML, CSS, dados)

**Files:**
- Modify: `volei-dashboard.html:1506-1524` (`PERMISSOES_UI`)
- Modify: `volei-dashboard.html:936` (nav superior) e `volei-dashboard.html:979` (menu "mais", mobile)
- Modify: `volei-dashboard.html:1344` (depois do fechamento de `view-placar`, nova `<section id="view-aovivo">`)
- Modify: `volei-dashboard.html:367` (bloco de CSS, logo depois de `.history-team .tn{...}`)
- Modify: `volei-dashboard.html:1488` (`DATA` inicial) e `volei-dashboard.html:1605` (`loadData`)

**Interfaces:**
- Produces: `DATA.aoVivo` = `{ rounds: [], log: [] }` (mesmo formato de `lerAoVivo()` no backend).
- Produces: seção `#view-aovivo` com container `#aovivo-list` (onde o Task 5 vai renderizar os cards) e um estado vazio `#aovivo-empty`.
- Produces: badge `#nav-aovivo-badge` / `#mais-aovivo-badge` (contagem de transmissões ativas), atualizados pelo Task 5.

- [ ] **Step 1: Adicionar `iniciarTransmissaoAoVivo`, `salvarParcialAoVivo` e `cancelarTransmissaoAoVivo` em `PERMISSOES_UI`**

Em `volei-dashboard.html:1506-1524`, depois da linha `updateRound: ['organizador','admin'],`:

```javascript
  iniciarTransmissaoAoVivo:  ['organizador','admin'],
  salvarParcialAoVivo:       ['organizador','admin'],
  cancelarTransmissaoAoVivo: ['organizador','admin'],
```

- [ ] **Step 2: Adicionar o botão de navegação (desktop e "mais" mobile)**

Em `volei-dashboard.html:936`, depois de `<button data-view="placar">Placar 🔢</button>`:

```html
      <button data-view="aovivo">Ao Vivo 🔴<span class="badge-count" id="nav-aovivo-badge" style="display:none;"></span></button>
```

Em `volei-dashboard.html:979` (dentro do menu "mais" do celular), depois de `<button class="mais-item" data-view="placar">...</button>`:

```html
        <button class="mais-item" data-view="aovivo"><span class="mais-item-icon">🔴</span>Ao Vivo<span class="badge-count" id="mais-aovivo-badge" style="display:none;"></span></button>
```

- [ ] **Step 3: Adicionar a seção `view-aovivo`**

Depois de `</section>` que fecha `view-placar` (linha 1344), adicionar:

```html
    <section id="view-aovivo">
      <h2 class="section-title">🔴 Ao Vivo</h2>
      <p style="color:var(--muted);font-size:13px;margin:-8px 0 16px;">Transmissão das rodadas com placar ainda não lançado. Pra transmitir uma, vá em Histórico → rascunho pendente → "Transmitir ao vivo".</p>
      <div id="aovivo-empty" class="empty"><i class="ti ti-broadcast"></i>Nenhuma transmissão ao vivo agora.</div>
      <div id="aovivo-list"></div>
    </section>
```

- [ ] **Step 4: Adicionar CSS dos elementos novos**

Depois de `.history-team .tn{...}` (linha 367), adicionar:

```css
  /* Ao Vivo */
  .aovivo-card{background:var(--court-navy-2);border:1px solid var(--ball-yellow);border-radius:12px;padding:16px;margin-bottom:20px;}
  .aovivo-card-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;}
  .aovivo-timer{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;}
  .aovivo-timer.esgotado{color:var(--danger);}
  .aovivo-stepper{display:flex;align-items:center;gap:10px;margin-top:8px;}
  .aovivo-stepper button{width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:var(--court-navy-3);color:inherit;font-size:18px;line-height:1;cursor:pointer;}
  .aovivo-stepper button:disabled{opacity:0.4;cursor:default;}
  .aovivo-stepper .valor{font-size:20px;font-weight:700;min-width:24px;text-align:center;}
  .aovivo-pendente{outline:2px solid var(--ball-yellow);}
  .aovivo-log{margin-top:14px;font-size:12px;color:var(--muted);max-height:140px;overflow-y:auto;}
  .aovivo-log div{padding:3px 0;border-bottom:1px solid var(--line);}
  .aovivo-acoes{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;}
```

- [ ] **Step 5: Inicializar `DATA.aoVivo` e ler do `loadData()`**

Em `volei-dashboard.html:1488`, trocar:

```javascript
let DATA = { players: [], rounds: [] };
```

por:

```javascript
let DATA = { players: [], rounds: [], aoVivo: { rounds: [], log: [] } };
```

Em `volei-dashboard.html:1605`, trocar:

```javascript
    DATA = { players: json.players || [], rounds: json.rounds || [] };
```

por:

```javascript
    DATA = { players: json.players || [], rounds: json.rounds || [], aoVivo: json.aoVivo || { rounds: [], log: [] } };
```

- [ ] **Step 6: Validar sintaxe**

```bash
python3 -c "
import re
content = open('volei-dashboard.html').read()
m = re.search(r'<script>(.*)</script>', content, re.S)
open('/tmp/check.js','w').write(m.group(1))
"
node --check /tmp/check.js
```
Expected: sem saída (sucesso silencioso).

- [ ] **Step 7: Verificação manual**

Abrir `volei-dashboard.html` direto no navegador (duplo clique ou `file://`). Confirmar: aba "Ao Vivo 🔴" aparece no menu de cima, leva pra uma tela com "Nenhuma transmissão ao vivo agora." e não quebra nenhuma outra tela do app.

- [ ] **Step 8: Commit**

```bash
git add volei-dashboard.html
git commit -m "Placar Ao Vivo: estrutura da página nova (nav, HTML, CSS, dados)"
```

---

## Task 4: Botão "Transmitir ao vivo" no Histórico

**Files:**
- Modify: `volei-dashboard.html` (função `pedirSenhaModal`, por volta da linha 2372 — adicionar `pedirDuracaoModal` logo depois)
- Modify: `volei-dashboard.html:4464-4485` (bloco de rascunhos dentro de `renderHistory`)

**Interfaces:**
- Consumes: `requireAuth('iniciarTransmissaoAoVivo')`, `postAction('iniciarTransmissaoAoVivo', {roundId, duracaoMinutos}, cred)`, `DATA.aoVivo`, `abrirTelaVia('aovivo')` (Task 3).
- Produces: `pedirDuracaoModal()` → `Promise<number|null>` (minutos digitados, ou `null` se cancelou).

- [ ] **Step 1: Escrever `pedirDuracaoModal`, reaproveitando o visual de `pedirSenhaModal`**

Logo depois do fechamento de `pedirSenhaModal` (`});` na linha ~2400), adicionar:

```javascript
function pedirDuracaoModal(){
  return new Promise((resolve)=>{
    const overlay = document.createElement('div');
    overlay.className = 'profile-overlay';
    overlay.innerHTML = `
      <div class="password-card">
        <p class="password-title">⏱️ Duração da partida (minutos)</p>
        <input type="number" id="duracao-input" class="password-field" placeholder="Ex: 12" min="1" inputmode="numeric">
        <div class="password-actions">
          <button class="btn" id="duracao-confirm-btn">Iniciar transmissão</button>
          <button class="btn secondary" id="duracao-cancel-btn">Cancelar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#duracao-input');
    setTimeout(()=> input.focus(), 50);
    function fechar(valor){ overlay.remove(); resolve(valor); }
    function confirmar(){
      const minutos = parseInt(input.value, 10);
      fechar(Number.isFinite(minutos) && minutos > 0 ? minutos : null);
    }
    overlay.querySelector('#duracao-confirm-btn').addEventListener('click', confirmar);
    overlay.querySelector('#duracao-cancel-btn').addEventListener('click', ()=> fechar(null));
    input.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter') confirmar();
      if(e.key === 'Escape') fechar(null);
    });
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) fechar(null); });
  });
}
```

- [ ] **Step 2: Adicionar o botão no card de rascunho e o handler de clique**

Em `volei-dashboard.html:4480`, trocar:

```html
        <button class="btn" data-lancar-placar="${r.id}" style="margin-top:12px;">Lançar placar →</button>
```

por:

```html
        <div class="acoes-linha" style="margin-top:12px;">
          <button class="btn" data-lancar-placar="${r.id}">Lançar placar →</button>
          <button class="btn secondary" data-transmitir-aovivo="${r.id}" ${DATA.aoVivo.rounds.some(av=>av.id===r.id) ? 'disabled title="Essa rodada já está ao vivo"' : ''}>📡 Transmitir ao vivo</button>
        </div>
```

E depois do bloco `draftsList.querySelectorAll('[data-lancar-placar]')...` (linha ~4485), adicionar:

```javascript
    draftsList.querySelectorAll('[data-transmitir-aovivo]:not([disabled])').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const roundId = btn.dataset.transmitirAovivo;
        const minutos = await pedirDuracaoModal();
        if(!minutos) return;
        const cred = await requireAuth('iniciarTransmissaoAoVivo');
        if(!cred) return;
        const ok = await postAction('iniciarTransmissaoAoVivo', {roundId, duracaoMinutos: minutos}, cred);
        if(!ok) return;
        mostrarToast('Transmissão iniciada! Abrindo a tela Ao Vivo...', 'sucesso');
        await recarregarAoVivo(); // função do Task 5 — busca o estado fresco de DATA.aoVivo
        abrirTelaVia('aovivo');
      });
    });
```

(`recarregarAoVivo` é escrita no Task 5 — este handler já a referencia porque o botão só faz sentido depois que ela existir; a ordem de tasks garante isso antes de qualquer teste manual do fluxo completo.)

- [ ] **Step 3: Validar sintaxe**

```bash
python3 -c "
import re
content = open('volei-dashboard.html').read()
m = re.search(r'<script>(.*)</script>', content, re.S)
open('/tmp/check.js','w').write(m.group(1))
"
node --check /tmp/check.js
```
Expected: sem saída (sucesso silencioso). Nesse ponto o `recarregarAoVivo` ainda não existe — isso só vira erro em tempo de EXECUÇÃO (ao clicar o botão), não de sintaxe, então o `node --check` passa normalmente.

- [ ] **Step 4: Commit**

```bash
git add volei-dashboard.html
git commit -m "Placar Ao Vivo: botão 'Transmitir ao vivo' no Histórico com modal de duração"
```

---

## Task 5: Renderização dos cards ao vivo (times, cronômetro, log) + polling

**Files:**
- Modify: `volei-dashboard.html` (novo bloco de funções, logo depois de `fecharEdicaoDeRodada` — por volta da linha 3636)
- Modify: `volei-dashboard.html:2604-2619` (handler de clique do `#nav`, pra ligar/desligar o polling ao entrar/sair da tela)

**Interfaces:**
- Consumes: `DATA.aoVivo`, `getPlayer`, `avatarHtml`, `nomeComApelidoHtml`, `escapeHtml`, `formatDate`, `temPermissao('salvarParcialAoVivo')`, `requireAuth`, `postAction`.
- Produces: `recarregarAoVivo()` → busca `lerAoVivo` fresco via POST e atualiza `DATA.aoVivo` + badges + (se a tela estiver aberta) os cards.
- Produces: `renderAoVivo()` → desenha `#aovivo-list` a partir de `DATA.aoVivo`.
- Produces: `iniciarPollingAoVivo()` / `pararPollingAoVivo()` — controlam o `setInterval` do polling.
- Produces: estado local `AOVIVO_PENDENTE` (`Set<roundId>`) — rodadas com alteração de stepper ainda não salva, que o polling não deve sobrescrever.
- Produces: estado local `AOVIVO_VITORIAS_LOCAIS` (`Map<roundId, number[]>`) — valores dos steppers ainda não salvos.

- [ ] **Step 1: Escrever o carregamento (fetch) e o polling**

Depois de `fecharEdicaoDeRodada` (linha ~3635), adicionar:

```javascript
/* ---------- AO VIVO ---------- */
let AOVIVO_POLL_TIMER = null;
let AOVIVO_CRONOMETRO_TIMER = null;
const AOVIVO_PENDENTE = new Set(); // roundIds com stepper alterado mas ainda não salvo
const AOVIVO_VITORIAS_LOCAIS = new Map(); // roundId -> array de vitórias local (inclui as pendentes)

// Busca o estado mais recente da transmissão via POST (nunca GET — GET pode ficar em
// cache e essa tela depende de dado sempre fresco). Silenciosa em caso de falha de
// rede: um poll que falhou tenta de novo sozinho no próximo ciclo, sem incomodar
// quem só está assistindo com um toast de erro a cada 8s de instabilidade.
async function recarregarAoVivo(){
  if(!sheetReady) return;
  try{
    const res = await fetch(SHEET_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'lerAoVivo' })
    });
    const json = await res.json();
    if(!json || json.error) return;
    DATA.aoVivo = { rounds: json.rounds || [], log: json.log || [] };
  }catch(e){
    console.error('Falha ao atualizar o Ao Vivo', e);
    return;
  }
  atualizarBadgeAoVivo();
  if(document.getElementById('view-aovivo').classList.contains('active')) renderAoVivo();
}

function atualizarBadgeAoVivo(){
  const total = DATA.aoVivo.rounds.length;
  ['nav-aovivo-badge', 'mais-aovivo-badge'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.textContent = String(total);
    el.style.display = total > 0 ? 'inline-flex' : 'none';
  });
}

// O cronômetro tem seu PRÓPRIO timer (1x por segundo), separado do polling do placar
// (a cada 9s) — os dois começam/terminam juntos porque só fazem sentido enquanto a
// tela "Ao Vivo" está aberta, mas rodam em frequências diferentes.
function iniciarPollingAoVivo(){
  pararPollingAoVivo();
  AOVIVO_POLL_TIMER = setInterval(recarregarAoVivo, 9000);
  AOVIVO_CRONOMETRO_TIMER = setInterval(atualizarCronometrosAoVivo, 1000);
}
function pararPollingAoVivo(){
  if(AOVIVO_POLL_TIMER){ clearInterval(AOVIVO_POLL_TIMER); AOVIVO_POLL_TIMER = null; }
  if(AOVIVO_CRONOMETRO_TIMER){ clearInterval(AOVIVO_CRONOMETRO_TIMER); AOVIVO_CRONOMETRO_TIMER = null; }
}
```

- [ ] **Step 2: Escrever o cronômetro (cálculo puro em minutos/segundos)**

Logo depois do bloco do Step 1:

```javascript
// Puro: dado o horário de início (ISO) e a duração em minutos, devolve quantos
// segundos faltam (pode ser negativo — usado só pra formatar "00:00" no fim).
function segundosRestantesAoVivo(iniciadoEm, duracaoMinutos){
  const inicio = new Date(iniciadoEm).getTime();
  if(!Number.isFinite(inicio)) return duracaoMinutos * 60;
  const fim = inicio + duracaoMinutos * 60000;
  return Math.round((fim - Date.now()) / 1000);
}

function formatarCronometro(segundos){
  const zerado = Math.max(0, segundos);
  const mm = String(Math.floor(zerado / 60)).padStart(2, '0');
  const ss = String(zerado % 60).padStart(2, '0');
  return mm + ':' + ss;
}

// Atualiza todos os cronômetros visíveis a partir de UM timer global (ligado em
// iniciarPollingAoVivo), em vez de um setInterval por card — um setInterval por card
// vazaria a cada renderAoVivo() (poll ou clique no stepper), já que o card antigo é
// substituído no DOM mas o timer dele continuaria rodando escondido pra sempre.
function atualizarCronometrosAoVivo(){
  DATA.aoVivo.rounds.forEach(round=>{
    const el = document.querySelector(`[data-aovivo-timer="${round.id}"]`);
    if(!el) return;
    const restantes = segundosRestantesAoVivo(round.iniciadoEm, round.duracaoMinutos);
    el.textContent = formatarCronometro(restantes);
    el.classList.toggle('esgotado', restantes <= 0);
  });
}
```

- [ ] **Step 3: Escrever `renderAoVivo` (cards, quadros de time, stepper, log)**

Logo depois do bloco do Step 2:

```javascript
function renderAoVivo(){
  const container = document.getElementById('aovivo-list');
  const empty = document.getElementById('aovivo-empty');
  const rounds = DATA.aoVivo.rounds;
  empty.style.display = rounds.length === 0 ? 'block' : 'none';
  const podeControlar = temPermissao('salvarParcialAoVivo');

  container.innerHTML = rounds.map(r=>{
    // enquanto há alteração pendente pra essa rodada, mostra os valores locais (ainda
    // não salvos) em vez dos que vieram do servidor — evita o polling "engolir" o
    // clique do organizador antes dele apertar "Salvar parcial"
    const vitoriasAtuais = AOVIVO_PENDENTE.has(r.id) ? AOVIVO_VITORIAS_LOCAIS.get(r.id) : r.times.map(t=>t.vitorias);
    const logDaRodada = DATA.aoVivo.log.filter(l=>l.roundId===r.id);
    return `
    <div class="aovivo-card ${AOVIVO_PENDENTE.has(r.id)?'aovivo-pendente':''}" data-aovivo-round="${r.id}">
      <div class="aovivo-card-head">
        <span class="history-date">${formatDate(r.data)} — início ${new Date(r.iniciadoEm).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>
        <span class="aovivo-timer" data-aovivo-timer="${r.id}"></span>
      </div>
      <div class="history-teams">
        ${r.times.map((t, idx)=>`
          <div class="history-team">
            <div class="tn">${escapeHtml(t.nome)}</div>
            ${t.playerIds.map(pid=>{ const p=getPlayer(pid); return `<div class="with-avatar" style="margin-bottom:4px;">${avatarHtml(p,'sm')}<span>${p?nomeComApelidoHtml(p):'(removido)'}</span></div>`; }).join('') || '<div style="color:var(--muted);font-size:12px;">Sem jogadores</div>'}
            ${podeControlar ? `
              <div class="aovivo-stepper">
                <button type="button" data-aovivo-menos="${r.id}" data-time="${idx}" ${vitoriasAtuais[idx]<=0?'disabled':''}>−</button>
                <span class="valor">${vitoriasAtuais[idx]}</span>
                <button type="button" data-aovivo-mais="${r.id}" data-time="${idx}">+</button>
              </div>
            ` : `<div class="aovivo-stepper"><span class="valor">${vitoriasAtuais[idx]}</span></div>`}
          </div>
        `).join('')}
      </div>
      <div class="aovivo-log">
        ${logDaRodada.length === 0 ? 'Nenhuma mudança registrada ainda.' : logDaRodada.map(l=>{
          const hora = new Date(l.timestamp).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
          return l.delta > 0
            ? `<div>${hora} ${escapeHtml(l.timeNome)} venceu (+${l.delta})</div>`
            : `<div>${hora} ${escapeHtml(l.timeNome)} teve ${Math.abs(l.delta)} ponto(s) retirado(s)</div>`;
        }).join('')}
      </div>
      ${podeControlar ? `
        <div class="aovivo-acoes">
          <button class="btn" data-aovivo-salvar="${r.id}" ${AOVIVO_PENDENTE.has(r.id)?'':'disabled'}>💾 Salvar parcial</button>
          <button class="btn secondary" data-aovivo-lancar="${r.id}">Lançar placar final →</button>
          <button class="btn secondary" data-aovivo-cancelar="${r.id}">Cancelar transmissão</button>
        </div>
      ` : ''}
    </div>`;
  }).join('');

  atualizarCronometrosAoVivo(); // desenha o valor inicial assim que os cards existem no DOM
  wireAoVivoSteppers();
  wireAoVivoAcoes();
}
```

- [ ] **Step 4: Ligar/desligar o polling e renderizar ao entrar/sair da tela "Ao Vivo"**

Em `volei-dashboard.html:2604-2619`, dentro do handler de clique do `#nav`, adicionar (junto aos outros `if(btn.dataset.view===...)`):

```javascript
  if(btn.dataset.view==='aovivo'){ renderAoVivo(); iniciarPollingAoVivo(); } else { pararPollingAoVivo(); }
```

(Esse `else` para o polling sempre que a pessoa sai da tela "Ao Vivo" pra qualquer outra — evita chamadas de fundo desnecessárias.)

- [ ] **Step 5: Validar sintaxe**

```bash
python3 -c "
import re
content = open('volei-dashboard.html').read()
m = re.search(r'<script>(.*)</script>', content, re.S)
open('/tmp/check.js','w').write(m.group(1))
"
node --check /tmp/check.js
```
Expected: sem saída (sucesso silencioso).

- [ ] **Step 6: Verificação manual do cronômetro (lógica pura, testável fora do navegador)**

Rodar um teste rápido em Node pra confirmar `segundosRestantesAoVivo`/`formatarCronometro` isoladamente (copiando as duas funções puras pra um arquivo de verificação, já que não dependem de DOM nem de Apps Script):

```bash
node -e "
function segundosRestantesAoVivo(iniciadoEm, duracaoMinutos){
  const inicio = new Date(iniciadoEm).getTime();
  if(!Number.isFinite(inicio)) return duracaoMinutos * 60;
  const fim = inicio + duracaoMinutos * 60000;
  return Math.round((fim - Date.now()) / 1000);
}
function formatarCronometro(segundos){
  const zerado = Math.max(0, segundos);
  const mm = String(Math.floor(zerado / 60)).padStart(2, '0');
  const ss = String(zerado % 60).padStart(2, '0');
  return mm + ':' + ss;
}
const agora = new Date().toISOString();
console.assert(formatarCronometro(segundosRestantesAoVivo(agora, 12)) === '11:59' || formatarCronometro(segundosRestantesAoVivo(agora, 12)) === '12:00', 'duração recém-iniciada deveria ficar perto de 12:00');
const passou = new Date(Date.now() - 13*60000).toISOString();
console.assert(formatarCronometro(segundosRestantesAoVivo(passou, 12)) === '00:00', 'tempo esgotado deveria mostrar 00:00, não negativo');
console.log('OK');
"
```
Expected: imprime `OK` sem nenhum `Assertion failed`.

- [ ] **Step 7: Commit**

```bash
git add volei-dashboard.html
git commit -m "Placar Ao Vivo: renderização dos cards, cronômetro e polling"
```

---

## Task 6: Steppers, "Salvar parcial" e "Cancelar transmissão"

**Files:**
- Modify: `volei-dashboard.html` (logo depois de `renderAoVivo`/`atualizarCronometrosAoVivo`, do Task 5)

**Interfaces:**
- Consumes: `AOVIVO_PENDENTE`, `AOVIVO_VITORIAS_LOCAIS`, `renderAoVivo`, `requireAuth`, `postAction`, `recarregarAoVivo` (Task 5).
- Produces: `wireAoVivoSteppers()`, `wireAoVivoAcoes()` (referenciadas no Task 5, Step 3, mas escritas aqui).

- [ ] **Step 1: Escrever `wireAoVivoSteppers` (clique local, sem salvar ainda)**

```javascript
function wireAoVivoSteppers(){
  function ajustar(roundId, timeIndex, delta){
    const round = DATA.aoVivo.rounds.find(r=>r.id===roundId);
    if(!round) return;
    if(!AOVIVO_VITORIAS_LOCAIS.has(roundId)){
      AOVIVO_VITORIAS_LOCAIS.set(roundId, round.times.map(t=>t.vitorias));
    }
    const valores = AOVIVO_VITORIAS_LOCAIS.get(roundId);
    valores[timeIndex] = Math.max(0, valores[timeIndex] + delta);
    AOVIVO_PENDENTE.add(roundId);
    renderAoVivo();
  }
  document.querySelectorAll('[data-aovivo-mais]').forEach(btn=>{
    btn.addEventListener('click', ()=> ajustar(btn.dataset.aovivoMais, Number(btn.dataset.time), 1));
  });
  document.querySelectorAll('[data-aovivo-menos]').forEach(btn=>{
    btn.addEventListener('click', ()=> ajustar(btn.dataset.aovivoMenos, Number(btn.dataset.time), -1));
  });
}
```

- [ ] **Step 2: Escrever `wireAoVivoAcoes` — "Salvar parcial" e "Cancelar transmissão"**

("Lançar placar final" fica pro Task 7 — aqui só cria o placeholder do listener pra não deixar o botão sem handler nenhum entre um task e outro.)

```javascript
function wireAoVivoAcoes(){
  document.querySelectorAll('[data-aovivo-salvar]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const roundId = btn.dataset.aovivoSalvar;
      const vitoriasPorTime = AOVIVO_VITORIAS_LOCAIS.get(roundId);
      if(!vitoriasPorTime) return;
      const cred = await requireAuth('salvarParcialAoVivo');
      if(!cred) return;
      const ok = await postAction('salvarParcialAoVivo', {roundId, vitoriasPorTime}, cred);
      if(!ok) return;
      AOVIVO_PENDENTE.delete(roundId);
      AOVIVO_VITORIAS_LOCAIS.delete(roundId);
      mostrarToast('Placar parcial salvo!', 'sucesso');
      await recarregarAoVivo();
    });
  });

  document.querySelectorAll('[data-aovivo-cancelar]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const roundId = btn.dataset.aovivoCancelar;
      if(!confirm('Cancelar esta transmissão? O rascunho continua no Histórico, só a transmissão ao vivo é encerrada.')) return;
      const cred = await requireAuth('cancelarTransmissaoAoVivo');
      if(!cred) return;
      const ok = await postAction('cancelarTransmissaoAoVivo', {roundId}, cred);
      if(!ok) return;
      AOVIVO_PENDENTE.delete(roundId);
      AOVIVO_VITORIAS_LOCAIS.delete(roundId);
      mostrarToast('Transmissão cancelada.', 'sucesso');
      await recarregarAoVivo();
    });
  });
}
```

- [ ] **Step 3: Validar sintaxe**

```bash
python3 -c "
import re
content = open('volei-dashboard.html').read()
m = re.search(r'<script>(.*)</script>', content, re.S)
open('/tmp/check.js','w').write(m.group(1))
"
node --check /tmp/check.js
```
Expected: sem saída (sucesso silencioso).

- [ ] **Step 4: Verificação manual (precisa da planilha configurada)**

1. Criar as abas `AoVivo` e `AoVivoLog` na planilha real, com os cabeçalhos exatos da Task 1, e colar a versão atualizada do `apps-script-codigo.gs` no editor do Apps Script, reimplantando como **Nova versão** (passo que o CLAUDE.md do projeto avisa ser fácil de esquecer).
2. No app, criar um rascunho de rodada com 2 times no Histórico.
3. Clicar "📡 Transmitir ao vivo", informar 5 minutos, confirmar que a tela "Ao Vivo" abre com o card da rodada, cronômetro contando e steppers em 0.
4. Clicar "+" duas vezes no Time 1 → confirma que o card fica com contorno amarelo (`aovivo-pendente`) e "💾 Salvar parcial" fica habilitado.
5. Clicar "💾 Salvar parcial" → confirma toast de sucesso, contorno amarelo some, e o log mostra "HH:MM Time 1 venceu (+2)".
6. Clicar "−" uma vez e salvar de novo → confirma que o log ganha uma segunda linha "HH:MM Time 1 teve 1 ponto retirado".
7. Abrir a mesma página em outra aba do navegador (simulando um espectador) e confirmar que, depois de ~9s, o placar e o log aparecem sem precisar de F5.
8. Clicar "Cancelar transmissão", confirmar, e checar que a rodada volta a aparecer como rascunho disponível no Histórico (com o botão "Transmitir ao vivo" liberado de novo).

- [ ] **Step 5: Commit**

```bash
git add volei-dashboard.html
git commit -m "Placar Ao Vivo: steppers, salvar parcial e cancelar transmissão"
```

---

## Task 7: "Lançar placar final" (reaproveitando a tela de edição de rodada)

**Files:**
- Modify: `volei-dashboard.html:3596-3626` (`abrirEdicaoDeRodada`)
- Modify: `volei-dashboard.html:3505-3556` (handler de `save-round-btn`)
- Modify: `volei-dashboard.html` (dentro de `wireAoVivoAcoes`, Task 6 — adicionar o handler de `data-aovivo-lancar`)

**Interfaces:**
- Consumes: `abrirEdicaoDeRodada`, `postAction`, `cancelarTransmissaoAoVivo` (via `postAction`), `EDITING_ROUND_ID`.
- Produces: variável global `EDITING_ROUND_FROM_AOVIVO` (`boolean`) — indica que a edição em andamento veio da tela Ao Vivo, pra saber se precisa limpar a transmissão depois de salvar.
- Produces: `abrirEdicaoDeRodadaAoVivo(roundId)` — como `abrirEdicaoDeRodada`, mas pré-preenche os campos de vitórias com o placar ao vivo atual (que pode já ter avançado além do que está salvo em `Rodadas`).

- [ ] **Step 1: Declarar a flag nova, junto de `EDITING_ROUND_ID`**

Em `volei-dashboard.html:2915` (`let EDITING_ROUND_ID = null;`), adicionar logo abaixo:

```javascript
let EDITING_ROUND_FROM_AOVIVO = false; // true quando "Salvar rodada" também precisa encerrar a transmissão ao vivo
```

- [ ] **Step 2: Escrever `abrirEdicaoDeRodadaAoVivo`**

Logo depois de `abrirEdicaoDeRodada` (linha ~3626), adicionar:

```javascript
// Igual abrirEdicaoDeRodada, mas os valores de vitórias vêm do placar AO VIVO atual
// (que pode estar mais avançado do que o rascunho salvo em "Rodadas") — e marca que,
// ao salvar, também precisa encerrar a transmissão.
function abrirEdicaoDeRodadaAoVivo(roundId){
  const aoVivo = DATA.aoVivo.rounds.find(r=>r.id===roundId);
  if(!aoVivo) return;
  abrirEdicaoDeRodada(roundId);
  EDITING_ROUND_FROM_AOVIVO = true;
  const grid = document.getElementById('teams-grid');
  aoVivo.times.forEach((t, ti)=>{
    const card = grid.querySelector(`.team-card[data-team="${ti}"]`);
    const winsInput = card && card.querySelector('[data-wins]');
    if(winsInput) winsInput.value = t.vitorias || 0;
  });
  updateLeader();
}
```

- [ ] **Step 3: Ligar o botão "Lançar placar final" (dentro de `wireAoVivoAcoes`, Task 6)**

Em `wireAoVivoAcoes` (Task 6), adicionar:

```javascript
  document.querySelectorAll('[data-aovivo-lancar]').forEach(btn=>{
    btn.addEventListener('click', ()=> abrirEdicaoDeRodadaAoVivo(btn.dataset.aovivoLancar));
  });
```

- [ ] **Step 4: Limpar a transmissão depois de um `updateRound` bem-sucedido vindo do Ao Vivo**

Em `volei-dashboard.html:3505-3543` (handler de `save-round-btn`, ramo `if(EDITING_ROUND_ID){ ... }`), depois da linha `mostrarToast('Rodada atualizada!', 'sucesso');` e antes de `fecharEdicaoDeRodada();`, adicionar:

```javascript
    if(EDITING_ROUND_FROM_AOVIVO){
      await postAction('cancelarTransmissaoAoVivo', {roundId: EDITING_ROUND_ID}, cred);
      EDITING_ROUND_FROM_AOVIVO = false;
      await recarregarAoVivo();
    }
```

E em `fecharEdicaoDeRodada` (linha ~3628), resetar a flag também (pra cobrir o caso de "Cancelar edição" sem salvar):

```javascript
function fecharEdicaoDeRodada(){
  EDITING_ROUND_ID = null;
  EDITING_ROUND_FROM_AOVIVO = false;
  document.getElementById('edit-round-banner').style.display = 'none';
  document.getElementById('save-round-btn').textContent = 'Salvar rodada';
  document.getElementById('round-date').valueAsDate = new Date();
  document.getElementById('round-team-count').value = '4';
  renderTeamsGrid();
}
```

(Substitui só as duas primeiras linhas da função já existente — o resto continua igual.)

- [ ] **Step 5: Validar sintaxe**

```bash
python3 -c "
import re
content = open('volei-dashboard.html').read()
m = re.search(r'<script>(.*)</script>', content, re.S)
open('/tmp/check.js','w').write(m.group(1))
"
node --check /tmp/check.js
```
Expected: sem saída (sucesso silencioso).

- [ ] **Step 6: Verificação manual**

1. Repetir os passos 1-4 da verificação do Task 6 (transmitir uma rodada, marcar algumas vitórias, salvar parcial).
2. Clicar "Lançar placar final →" → confirma que abre "Nova rodada" em modo de edição, com o banner "✏️ Editando o rascunho..." e os campos de vitórias já preenchidos com o placar ao vivo (não com o que estava salvo antes de transmitir).
3. Clicar "Salvar rodada (finalizar)" → confirma toast "Rodada atualizada!", que a rodada some da tela Ao Vivo, aparece em Histórico como lançada (não mais rascunho) com o vencedor certo, e que a aba `AoVivo`/`AoVivoLog` da planilha ficou sem linhas dessa rodada.
4. Clicar "Cancelar edição" no meio do processo (sem salvar) → confirma que a transmissão AO VIVO continua ativa normalmente (não foi encerrada só por abrir a tela de edição e desistir).

- [ ] **Step 7: Commit**

```bash
git add volei-dashboard.html
git commit -m "Placar Ao Vivo: lançar placar final reaproveitando a edição de rodada"
```

---

## Task 8: Versão, changelog e QA manual de ponta a ponta

**Files:**
- Modify: `volei-dashboard.html:1475` (rodapé, `Ver.: X.X`)
- Modify: `volei-dashboard.html` (dentro de `#info-changelog`, novo `<details>` no topo da lista)

- [ ] **Step 1: Adicionar a entrada no Log de Alterações**

Em `volei-dashboard.html`, logo depois de `<div id="info-changelog">` e do parágrafo de introdução (antes do primeiro `<details class="dash-accordion" open>` existente), adicionar um novo `<details>` e tirar o `open` do que hoje é o primeiro da lista (só o mais recente fica aberto por padrão):

```html
        <details class="dash-accordion" open>
          <summary>17/09/2026 — v7.0: Placar Ao Vivo</summary>
          <div>
            <p style="line-height:1.6;">Nova tela <strong>"Ao Vivo 🔴"</strong>: rodadas com placar ainda não lançado (rascunhos) podem ser transmitidas ao vivo direto do Histórico, com os times em quadros, cronômetro regressivo da duração da partida e um contador de vitórias controlado por organizador/admin.</p>
            <p style="line-height:1.6;">Toda mudança de placar fica registrada num log público com horário (ex: "20:15 Time 1 venceu (+1)"), inclusive quando um ponto lançado errado é corrigido — serve de conferência pra quem está assistindo.</p>
            <p style="line-height:1.6;">Quem só está assistindo vê o placar e o log atualizarem sozinhos, sem precisar recarregar a página.</p>
          </div>
        </details>
```

E trocar o `<details class="dash-accordion" open>` da entrada de 16/09/2026 (v5.18) para `<details class="dash-accordion">` (sem `open`).

- [ ] **Step 2: Subir a versão do rodapé**

Em `volei-dashboard.html:1475`, trocar:

```html
    <div class="footer-line">Ver.: 6.4 · <span id="visit-counter"></span></div>
```

por:

```html
    <div class="footer-line">Ver.: 7.0 · <span id="visit-counter"></span></div>
```

(Número redondo porque é uma funcionalidade nova e grande, seguindo a convenção do projeto — não um ajuste pequeno.)

- [ ] **Step 3: Validar sintaxe**

```bash
python3 -c "
import re
content = open('volei-dashboard.html').read()
m = re.search(r'<script>(.*)</script>', content, re.S)
open('/tmp/check.js','w').write(m.group(1))
"
node --check /tmp/check.js
```
Expected: sem saída (sucesso silencioso).

- [ ] **Step 4: QA manual de ponta a ponta**

Com a planilha real configurada (abas `AoVivo`/`AoVivoLog` criadas, `.gs` reimplantado como Nova Versão):

1. Criar um rascunho com 4 times (não só 2), transmitir ao vivo, e confirmar que o grid de quadros se adapta a 4 colunas igual ao Histórico.
2. Transmitir uma SEGUNDA rodada rascunho ao mesmo tempo e confirmar que as duas aparecem na mesma tela "Ao Vivo", uma embaixo da outra, cada uma com seu próprio cronômetro/log/steppers independentes.
3. Deixar o cronômetro de uma delas chegar a zero (usar 1 minuto de duração pra agilizar o teste) e confirmar que mostra "00:00" em vermelho, sem travar nenhum botão.
4. Tentar clicar "Transmitir ao vivo" duas vezes seguidas na mesma rodada (ex: dois cliques rápidos ou em duas abas) e confirmar que a segunda tentativa recebe o erro tratado ("Essa rodada já está sendo transmitida ao vivo."), sem quebrar a tela.
5. Testar como um espectador sem login: confirmar que a tela "Ao Vivo" e o log aparecem normalmente, mas sem nenhum botão de controle (steppers, salvar, cancelar, lançar).
6. Conferir visualmente a tela em modo claro e escuro (toggle já existente do app), garantindo que `.aovivo-card`, `.aovivo-timer` e `.aovivo-log` têm contraste legível nos dois modos.

- [ ] **Step 5: Commit**

```bash
git add volei-dashboard.html
git commit -m "Placar Ao Vivo: versão 7.0, changelog e QA de ponta a ponta"
```

---

## Depois deste plano

Conforme a regra do projeto (CLAUDE.md): **parar aqui**. Mostrar o resultado funcionando só no Terça e esperar autorização explícita antes de tocar em `volei-meme-dashboard.html` / `apps-script-codigo-volei-meme.gs`. Só depois de autorizado, replicar a mesma mudança pro Meme (voltando as versões dos dois apps a ficarem iguais nesse momento).
