# Cartão do Jogador (visual futurista) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o cabeçalho/estatísticas do perfil (Meu Perfil e modal) e as linhas da lista Jogadores por um cartão único no visual da imagem de referência (borda em degradê ciano→roxo, avatar com anel neon e hexágono numerado, emblemas separados, pílula `>` que expande 4 métricas).

**Architecture:** Uma função **pura** `jogadorCardHtml(d, opcoes)` (testada em Node por marcadores `// <jogador-card-puro>`) gera o HTML nas variações `lista` (fechado, expansível) e `perfil` (sempre aberto). Uma camada fina impura (`contextoCards`, `montarDadosCard`) monta os dados a partir de `DATA`. O visual vem só de tokens CSS (`--accent`, `--neon-purple`, `--glass-*`), então o Meme herda com a paleta dele. Tudo continua no arquivo único `volei-dashboard.html`.

**Tech Stack:** HTML + CSS + JS puro; Tabler Icons (já carregado); container queries CSS; sem biblioteca nova.

**Spec:** `docs/superpowers/specs/2026-09-18-card-jogador-design.md` (a Task 1 acrescenta ao spec a seção "Ajustes feitos no planejamento" com 5 refinamentos).

## Global Constraints

- Só o **Terça** (`volei-dashboard.html`). Nenhuma mudança em `volei-meme-dashboard.html` nem em `.gs` até autorização explícita (regra do CLAUDE.md). Sem mudança de backend.
- Toda mudança em JS passa pela validação de sintaxe (comando exato em cada task).
- Versão do rodapé: `Ver.: 8.5` → `Ver.: 8.6` (na Task 3), com entrada no Log de Alterações (`#info-changelog`).
- `backdrop-filter` **nunca** no cartão da lista (regra do projeto: blur só em superfícies de destaque).
- A tela **Ao Vivo** não pode ganhar animação de entrada; o cartão só anima na lista (`.jc-lista`).
- O toque em "Títulos" no perfil (ver as datas de campeão) **não pode se perder**: ids `meuperfil-titulos-clicavel` e `profile-fotos-clicavel` continuam existindo.
- Expandir/recolher o cartão **não** chama `renderPlayers()` (reiniciaria a animação de entrada e piscaria).
- Modo claro legível em todas as telas; nenhuma rolagem horizontal em 360px.
- Comentários em português explicando o *porquê*; nomes de função em português.
- Ambiente Windows: nos comandos, `TMP="C:/Users/Heleno/AppData/Local/Temp/claude"`. Scripts de teste ficam em `TMP` (não versionados).
- Branch de trabalho: `card-jogador` (já criada). Cada task termina com um commit nela.

## Estrutura de arquivos

- **Modificar apenas:** `volei-dashboard.html`
  - `<style>`: bloco novo no **fim** (antes de `</style>`)
  - `<script>`: `jogadorCardHtml` (puro) e `montarDadosCard`/`contextoCards` colados **logo antes** de `function renderPlayers(){`; `JOGADOR_CARD_ABERTOS` ao lado de `let EDITING_PLAYER_ID`; integrações em `renderPlayers`, `renderMeuPerfil`, `openPlayerProfile`
  - rodapé e `#info-changelog`
- **Modificar:** `docs/superpowers/specs/2026-09-18-card-jogador-design.md` (Task 1, seção de ajustes)
- **Fora do repositório:** `TMP/test_card.js`, `TMP/test_card_dados.js`

---

## Task 1: Componente puro `jogadorCardHtml` + CSS do cartão

**Files:**
- Modify: `volei-dashboard.html` — inserir a função antes de `function renderPlayers(){`; CSS antes de `</style>`
- Modify: `docs/superpowers/specs/2026-09-18-card-jogador-design.md` (anexar seção de ajustes)
- Test (fora do repo): `TMP/test_card.js`

**Interfaces:**
- Produces: `jogadorCardHtml(d, opcoes): string` (puro; depende só de `escapeHtml`), com

```
d = { id, nome, apelido, foto, sexo /*'M'|'F'|''*/, temConta /*bool*/,
      emblemasHtml /*string*/, posicao /*number|null*/,
      metricas /*{partidas, titulos, pct}|null*/, estrelas /*number|null*/,
      ausenciaHtml /*string*/, tagsExtraHtml /*string*/, acoesHtml /*string*/ }
opcoes = { variante: 'lista'|'perfil', aberto: bool, tituloId: string|null }
```

- [ ] **Step 1: Escrever o teste (antes do código)**

Criar `TMP/test_card.js`:

```javascript
const fs = require('fs');
const assert = require('assert');
const html = fs.readFileSync('c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS/volei-dashboard.html', 'utf8');
const trecho = html.split('// <jogador-card-puro>')[1].split('// </jogador-card-puro>')[0];
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const { jogadorCardHtml } = new Function('escapeHtml', trecho + '; return { jogadorCardHtml };')(escapeHtml);

const base = { id:'p1', nome:'Ana', apelido:'', foto:'', sexo:'F', temConta:false, emblemasHtml:'', posicao:null,
  metricas:{ partidas:24, titulos:16, pct:67 }, estrelas:null, ausenciaHtml:'', tagsExtraHtml:'', acoesHtml:'' };
const c = (over, op) => jogadorCardHtml(Object.assign({}, base, over), op || { variante:'lista' });
const n = (h, re) => (h.match(new RegExp(re, 'g')) || []).length;

// --- avatar
assert.ok(c({ nome:'zeca' }).includes('>Z<'));                                   // sem foto: inicial do nome
assert.ok(c({ nome:'zeca', apelido:'bia' }).includes('>B<'));                     // apelido tem prioridade (igual ao avatarHtml do app)
assert.ok(c({ foto:'http://x/y.jpg' }).includes('src="http://x/y.jpg"'));
assert.ok(!c({ foto:'http://x/y.jpg' }).includes('jc-foto-inicial'));
assert.ok(c({ foto:'a"b' }).includes('a&quot;b'));                                // foto escapada

// --- escape de texto
const inj = c({ nome:'<b>x</b>', apelido:'<i>y</i>' });
assert.ok(inj.includes('&lt;b&gt;') && !inj.includes('<b>x'));
assert.ok(inj.includes('&lt;i&gt;') && !inj.includes('<i>y'));

// --- sem partidas: sem painel, sem botão
const nunca = c({ metricas:null }, { variante:'lista', aberto:true });
assert.ok(!nunca.includes('jc-painel') && !nunca.includes('jc-toggle') && !/\baberto\b/.test(nunca));

// --- estrelas: 4 colunas (com nota) ou 3 (oculta / zero)
assert.ok(c({ estrelas:4.5 }).includes('--jc-cols:4') && c({ estrelas:4.5 }).includes('>4,5<'));
assert.ok(c({ estrelas:4 }).includes('>4<'));
assert.ok(c({ estrelas:null }).includes('--jc-cols:3'));
assert.ok(c({ estrelas:0 }).includes('--jc-cols:3'));

// --- hexágono
assert.ok(!c({ posicao:null }).includes('jc-hex'));
assert.ok(c({ posicao:8 }).includes('<span>8</span>'));

// --- variante lista
const lista = c({}, { variante:'lista' });
assert.ok(lista.includes('jc-lista') && lista.includes('jc-toggle') && lista.includes('aria-expanded="false"'));
assert.ok(lista.includes('data-open-profile="p1"'));
assert.ok(!/\baberto\b/.test(lista));
const listaAberta = c({}, { variante:'lista', aberto:true });
assert.ok(/class="jogador-card jc-lista aberto"/.test(listaAberta) && listaAberta.includes('aria-expanded="true"'));
assert.ok(!lista.includes('ranking-titulos-clicavel'));                           // sem tituloId na lista: título não é clicável

// --- variante perfil
const perfil = c({}, { variante:'perfil', tituloId:'meuperfil-titulos-clicavel' });
assert.ok(perfil.includes('jc-perfil') && !perfil.includes('jc-toggle'));
assert.ok(!perfil.includes('data-open-profile'));                                 // senão o nome reabriria o próprio perfil
assert.ok(perfil.includes('id="meuperfil-titulos-clicavel"') && perfil.includes('ranking-titulos-clicavel'));

// --- conta Google e sexo
assert.ok(c({ temConta:true }).includes('jc-icone-conta') && !c({ temConta:false }).includes('jc-icone-conta'));
assert.ok(c({ sexo:'M' }).includes('jc-sexo-M') && c({ sexo:'M' }).includes('Masculino'));
assert.ok(c({ sexo:'F' }).includes('jc-sexo-F') && c({ sexo:'F' }).includes('Feminino'));
const semSexo = c({ sexo:'' });
assert.ok(!semSexo.includes('badge-gender') && !semSexo.includes('jc-sexo'));

// --- trechos prontos passam direto
const emb = '<span class="badge-icon">📸</span>';
assert.ok(c({ emblemasHtml:emb }).includes(emb));
const aus = '<span class="player-absence">Sem Participações</span>';
assert.ok(c({ ausenciaHtml:aus, metricas:null }).includes(aus));                  // aparece mesmo sem métricas
const acoes = '<button class="icon-btn" data-edit="p1">✏️</button>';
const comAcoes = c({ acoesHtml:acoes });
assert.ok(comAcoes.includes(acoes) && comAcoes.indexOf(acoes) < comAcoes.indexOf('jc-toggle')); // ações antes do ">"
assert.ok(c({ tagsExtraHtml:'<span class="porte-badge">X</span>' }).includes('porte-badge'));

// --- HTML bem formado (divs balanceadas) em todas as combinações
[ {}, { metricas:null }, { estrelas:4.5, posicao:3, temConta:true, sexo:'M', emblemasHtml:emb, apelido:'a' } ].forEach(over => {
  [ { variante:'lista' }, { variante:'lista', aberto:true }, { variante:'perfil', tituloId:'t' } ].forEach(op => {
    const h = c(over, op);
    assert.strictEqual(n(h, '<div'), n(h, '</div>'), 'divs desbalanceadas: ' + JSON.stringify(over) + JSON.stringify(op));
  });
});
console.log('OK — cartão do jogador');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/test_card.js"
```
Expected: `TypeError: Cannot read properties of undefined (reading 'split')` (o marcador ainda não existe).

- [ ] **Step 3: Escrever a função pura**

Inserir **imediatamente antes** de `function renderPlayers(){` em `volei-dashboard.html`:

```javascript
// <jogador-card-puro>
/* Cartão do jogador (visual futurista). PURO: não lê DATA nem o DOM — quem chama monta o "d".
   Duas variações: 'lista' (fechado, com ">" que abre as métricas) e 'perfil' (sempre aberto).
   Function declaration (e não const) de propósito: renderPlayers pode rodar antes desta linha
   ser avaliada e uma const cairia na "zona morta temporal". */
function jcIconeGoogle(){
  return '<svg class="jc-google" viewBox="0 0 48 48" width="16" height="16" aria-hidden="true">'
    + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
    + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
    + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
    + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>'
    + '</svg>';
}
function jcFormatarEstrelas(n){ return (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace('.', ','); }
function jcMetricaHtml(icone, cor, rotulo, valorHtml){
  return `<div class="jc-metrica"><i class="ti ${icone} jc-metrica-icone ${cor}"></i><div class="jc-metrica-txt"><span class="jc-rotulo">${rotulo}</span>${valorHtml}</div></div>`;
}
function jogadorCardHtml(d, opcoes){
  const op = opcoes || {};
  const perfil = op.variante === 'perfil';
  const inicial = escapeHtml((d.apelido || d.nome || '?').charAt(0).toUpperCase());
  const foto = d.foto
    ? `<img class="jc-foto" src="${escapeHtml(d.foto)}" alt="">`
    : `<div class="jc-foto jc-foto-inicial">${inicial}</div>`;
  const hex = d.posicao ? `<div class="jc-hex" title="Posição no ranking do ano"><span>${d.posicao}</span></div>` : '';
  // na variação 'perfil' o nome NÃO é data-open-profile: dentro do modal isso reabriria o próprio perfil
  const nome = `<span class="jc-nome"${perfil ? '' : ` data-open-profile="${escapeHtml(d.id)}"`}>${escapeHtml(d.nome || '')}</span>`;

  const partesIcones = [];
  if(d.sexo === 'M') partesIcones.push('<i class="ti ti-gender-male jc-sexo jc-sexo-M" title="Masculino"></i>');
  if(d.sexo === 'F') partesIcones.push('<i class="ti ti-gender-female jc-sexo jc-sexo-F" title="Feminino"></i>');
  if(d.temConta) partesIcones.push(`<span class="jc-icone-conta" title="Jogador com conta cadastrada no app">${jcIconeGoogle()}</span>`);
  const iconesInterno = partesIcones.join('') + (d.emblemasHtml || '');
  const icones = iconesInterno ? `<span class="jc-icones">${iconesInterno}</span>` : '';

  const apelido = d.apelido ? `<div class="jc-apelido">"${escapeHtml(d.apelido)}"</div>` : '';
  const pilula = d.sexo ? `<span class="badge-gender ${d.sexo}">${d.sexo === 'F' ? 'Feminino' : 'Masculino'}</span>` : '';
  const tagsInterno = pilula + (d.ausenciaHtml || '') + (d.tagsExtraHtml || '');
  const tags = tagsInterno ? `<div class="jc-linha-tags">${tagsInterno}</div>` : '';

  const toggle = (!perfil && d.metricas)
    ? `<button type="button" class="jc-toggle" aria-expanded="${op.aberto ? 'true' : 'false'}" aria-label="Mostrar estatísticas" data-som="nav"><i class="ti ti-chevron-right"></i></button>`
    : '';
  const acoesInterno = (d.acoesHtml || '') + toggle;
  const acoes = acoesInterno ? `<div class="jc-acoes">${acoesInterno}</div>` : '';

  let painel = '';
  if(d.metricas){
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
    // estrelas ocultas pelo admin (ou nota zero): a coluna some e as outras se redistribuem
    if(d.estrelas != null && d.estrelas > 0){
      colunas.push(jcMetricaHtml('ti-star', 'jc-cor-roxo', 'Estrelas', `<span class="jc-valor">${jcFormatarEstrelas(d.estrelas)}</span>`));
    }
    painel = `<div class="jc-painel"><div class="jc-painel-int"><div class="jc-metricas" style="--jc-cols:${colunas.length}">${colunas.join('')}</div></div></div>`;
  }

  const classes = ['jogador-card', perfil ? 'jc-perfil' : 'jc-lista'];
  if(!perfil && op.aberto && d.metricas) classes.push('aberto');
  return `<div class="${classes.join(' ')}" data-jc-id="${escapeHtml(d.id)}">
    <div class="jc-topo">
      <div class="jc-avatar-bloco"><div class="jc-anel">${foto}</div>${hex}</div>
      <div class="jc-info">
        <div class="jc-linha-nome">${nome}${icones}</div>
        ${apelido}${tags}
      </div>
      ${acoes}
    </div>
    ${painel}
  </div>`;
}
// </jogador-card-puro>

```

- [ ] **Step 4: Rodar o teste**

```bash
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/test_card.js"
```
Expected: `OK — cartão do jogador`.

- [ ] **Step 5: CSS do cartão**

Inserir imediatamente antes de `</style>`:

```css
  /* ===== CARTÃO DO JOGADOR ===== */
  .jogador-card{
    /* fundo OPACO de propósito: o degradê da borda vive numa camada "border-box" por baixo, e um fundo
       translúcido deixaria o degradê vazar pelo miolo do cartão */
    --jc-fundo:var(--court-navy-2);
    position:relative;container-type:inline-size;container-name:jc;
    border:1.5px solid transparent;border-radius:16px;
    background:
      linear-gradient(var(--jc-fundo), var(--jc-fundo)) padding-box,
      linear-gradient(120deg, var(--accent), var(--neon-purple)) border-box;
    box-shadow:var(--glass-brilho);
  }
  /* raio de luz diagonal (só no escuro) — pointer-events:none pra nunca capturar clique */
  .jogador-card::before{
    content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
    background:linear-gradient(115deg, transparent 0 58%, color-mix(in srgb, var(--accent) 9%, transparent) 58% 64%, transparent 64% 100%);
  }
  body.light-mode .jogador-card::before{display:none;}
  .jc-lista{animation:entrar .35s ease both;}
  .jc-perfil{margin-bottom:16px;}

  .jc-topo{position:relative;display:flex;align-items:center;gap:14px;padding:14px 14px 14px 16px;}
  .jc-avatar-bloco{position:relative;flex:none;}
  .jc-anel{
    padding:3px;border-radius:50%;background:linear-gradient(135deg, var(--accent), var(--neon-purple));
    box-shadow:0 0 14px color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .jc-foto{display:block;width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid var(--jc-fundo);}
  .jc-foto-inicial{display:flex;align-items:center;justify-content:center;background:var(--court-navy-3);font-family:'Anton',sans-serif;font-size:22px;color:var(--muted);}
  .jc-perfil .jc-foto{width:68px;height:68px;}
  /* hexágono: um clip-path de contorno (degradê) com outro, menor e escuro, por cima */
  .jc-hex{
    position:absolute;left:-4px;bottom:-8px;width:32px;height:36px;display:grid;place-items:center;
    background:linear-gradient(135deg, var(--accent), var(--neon-purple));
    clip-path:polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  }
  .jc-hex span{
    display:grid;place-items:center;width:28px;height:32px;background:var(--jc-fundo);
    clip-path:polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
    font-weight:800;font-size:14px;
  }

  .jc-info{flex:1;min-width:0;}
  .jc-linha-nome{display:flex;flex-wrap:wrap;align-items:center;gap:4px 0;}
  .jc-nome{font-weight:800;font-size:18px;line-height:1.15;margin-right:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;}
  .jc-lista .jc-nome{cursor:pointer;}
  .jc-lista .jc-nome:hover{color:var(--accent);}
  .jc-perfil .jc-nome{font-size:24px;}
  .jc-icones{display:flex;align-items:center;flex-wrap:wrap;padding-left:12px;border-left:1px solid var(--glass-borda);}
  .jc-icones > * + *{margin-left:8px;padding-left:8px;border-left:1px solid var(--glass-borda);}
  .jc-icones .badge-icon{font-size:18px;margin-left:0;padding:0 2px;}
  .jc-icones > .badge-icon + .badge-icon{margin-left:8px;}
  .jc-sexo{font-size:20px;}
  .jc-sexo-M{color:var(--accent);}
  .jc-sexo-F{color:#ff8fc0;}
  body.light-mode .jc-sexo-F{color:#c2255c;}
  .jc-icone-conta{display:inline-flex;align-items:center;}
  .jc-apelido{font-size:12px;color:var(--muted);margin-top:2px;}
  .jc-linha-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;}
  .jc-linha-tags .badge-gender{padding:3px 12px;border-radius:20px;font-size:12px;}

  .jc-acoes{display:flex;align-items:center;gap:4px;flex:none;}
  .jc-toggle{
    width:44px;height:30px;border-radius:20px;border:1px solid var(--glass-borda);cursor:pointer;
    background:color-mix(in srgb, var(--accent) 7%, transparent);color:var(--accent);
    display:grid;place-items:center;
  }
  .jc-toggle i{transition:transform .25s ease;}
  .jogador-card.aberto .jc-toggle i{transform:rotate(90deg);}

  /* painel das métricas: abre por altura suave (grid 0fr -> 1fr), sem medir conteúdo em JS */
  .jc-painel{display:grid;grid-template-rows:0fr;transition:grid-template-rows .3s ease;}
  .jogador-card.aberto .jc-painel, .jc-perfil .jc-painel{grid-template-rows:1fr;}
  .jc-painel-int{overflow:hidden;min-height:0;}
  .jc-metricas{
    display:grid;grid-template-columns:repeat(var(--jc-cols,4), 1fr);padding:14px 16px;
    border-top:1px solid transparent;border-image:linear-gradient(90deg, transparent, var(--accent), transparent) 1;
  }
  .jc-metrica{display:flex;align-items:center;gap:10px;padding:0 10px;min-width:0;}
  .jc-metrica + .jc-metrica{border-left:1px solid var(--line);}
  .jc-metrica-icone{font-size:26px;flex:none;}
  .jc-cor-accent{color:var(--accent);}
  .jc-cor-ouro{color:var(--ball-yellow);}
  .jc-cor-roxo{color:var(--neon-purple);}
  .jc-metrica-txt{display:flex;flex-direction:column;min-width:0;}
  .jc-rotulo{font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--accent);white-space:nowrap;}
  .jc-valor{font-size:24px;font-weight:800;line-height:1.1;}
  /* responsivo pela largura do PRÓPRIO cartão (e não da tela): o modal de perfil tem 440px em qualquer aparelho */
  @container jc (max-width: 479px){
    .jc-metricas{grid-template-columns:1fr 1fr;row-gap:12px;}
    .jc-metrica + .jc-metrica{border-left:none;}
    .jc-metrica:nth-child(even){border-left:1px solid var(--line);}
    .jc-metrica-icone{font-size:22px;}
    .jc-valor{font-size:20px;}
  }
```

- [ ] **Step 6: Rodar teste e validar sintaxe**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/test_card.js"
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.argv[1]+'/check_html.js',m[1]);" "$TMP" && node --check "$TMP/check_html.js" && echo "SINTAXE OK"
```
Expected: `OK — cartão do jogador` e `SINTAXE OK`.

- [ ] **Step 7: Registrar os ajustes no spec**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
cat >> docs/superpowers/specs/2026-09-18-card-jogador-design.md <<'EOF'

## Ajustes feitos no planejamento (2026-09-18)

Refinamentos descobertos ao ler o código; valem no lugar do que estiver dito acima:

1. **`estrelas` (número | null) no lugar de `estrelasHtml`:** a coluna mostra o valor ("4,5"), não as 5 estrelinhas, que não cabem numa coluna. `null` ou `0` = coluna oculta.
2. **Novo campo `tagsExtraHtml`:** o modal de perfil já mostra o emblema de *porte* ao lado do sexo; ele passa por aqui para não sumir.
3. **Fundo do cartão opaco** (`--court-navy-2`), não `--glass-bg`: o degradê da borda fica numa camada por baixo e vazaria por um miolo translúcido.
4. **Responsivo por *container query*** (cartão com menos de 480px → métricas em 2×2), no lugar das faixas 360/340px por tela: o modal de perfil tem 440px em qualquer aparelho.
5. **`data-open-profile` só na variação `lista`:** na variação `perfil` (dentro do modal) o clique global reabriria o próprio perfil.
EOF
```

- [ ] **Step 8: Commit**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
git add volei-dashboard.html docs/superpowers/specs/2026-09-18-card-jogador-design.md
git commit -m "$(cat <<'EOF'
Cartão do jogador: componente puro jogadorCardHtml e CSS (ainda sem uso)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Dados do cartão e integração na lista Jogadores

**Files:**
- Modify: `volei-dashboard.html` — funções de dados (antes de `function renderPlayers(){`), `let EDITING_PLAYER_ID` (~linha 3323), corpo de `renderPlayers`, listener do `>` (logo depois de `renderPlayers`)
- Test (fora do repo): `TMP/test_card_dados.js`

**Interfaces:**
- Consumes: `jogadorCardHtml(d, opcoes)` (Task 1); helpers já existentes `computePlayerAllTimeStats(id)`, `temContaVinculada(id)`, `badgeIconsHtml(id, badges)`, `computeRanking(ano)`, `computeBadges()`, `starsVisibleNow()`.
- Produces: `contextoCards(): { badges, posicoes: {[id]: number}, mostrarEstrelas: boolean }`; `montarDadosCard(player, ctx, extras?): d` (o `d` da Task 1); `const JOGADOR_CARD_ABERTOS = new Set()`.

- [ ] **Step 1: Escrever o teste dos dados**

Criar `TMP/test_card_dados.js`:

```javascript
const fs = require('fs');
const assert = require('assert');
const html = fs.readFileSync('c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS/volei-dashboard.html', 'utf8');
const trecho = html.split('// <card-dados>')[1].split('// </card-dados>')[0];

// dependências do app, substituídas por versões falsas
const stats = { a:{ jogos:24, titulos:16, pct:67 }, b:{ jogos:0, titulos:0, pct:0 } };
let estrelasVisiveis = true;
const { contextoCards, montarDadosCard } = new Function(
  'computePlayerAllTimeStats', 'temContaVinculada', 'badgeIconsHtml', 'computeRanking', 'computeBadges', 'starsVisibleNow',
  trecho + '; return { contextoCards, montarDadosCard };'
)(
  id => stats[id], id => id === 'a', (id, b) => '<badges:' + id + ':' + b + '>',
  ano => [{ id:'z' }, { id:'a' }], () => 'BADGES', () => estrelasVisiveis
);

const ctx = contextoCards();
assert.deepStrictEqual(ctx.posicoes, { z:1, a:2 });      // posição = índice do ranking + 1
assert.strictEqual(ctx.badges, 'BADGES');
assert.strictEqual(ctx.mostrarEstrelas, true);

const ana = montarDadosCard({ id:'a', nome:'Ana', apelido:'An', foto:'f.jpg', sexo:'F', estrelas:4.5 }, ctx);
assert.deepStrictEqual(ana.metricas, { partidas:24, titulos:16, pct:67 });
assert.strictEqual(ana.posicao, 2);
assert.strictEqual(ana.temConta, true);
assert.strictEqual(ana.estrelas, 4.5);
assert.strictEqual(ana.emblemasHtml, '<badges:a:BADGES>');
assert.strictEqual(ana.apelido, 'An');

// nunca jogou: sem métricas e sem hexágono
const bia = montarDadosCard({ id:'b', nome:'Bia', estrelas:3 }, ctx);
assert.strictEqual(bia.metricas, null);
assert.strictEqual(bia.posicao, null);
assert.strictEqual(bia.temConta, false);

// estrelas: oculta pelo admin, zero e texto vindo da planilha
assert.strictEqual(montarDadosCard({ id:'a', nome:'A', estrelas:4 }, Object.assign({}, ctx, { mostrarEstrelas:false })).estrelas, null);
assert.strictEqual(montarDadosCard({ id:'a', nome:'A', estrelas:0 }, ctx).estrelas, null);
assert.strictEqual(montarDadosCard({ id:'a', nome:'A', estrelas:'3.5' }, ctx).estrelas, 3.5);
assert.strictEqual(montarDadosCard({ id:'a', nome:'A' }, ctx).estrelas, null);     // sem nota cadastrada

// campos opcionais têm padrão seguro e "extras" sobrescreve
const nu = montarDadosCard({ id:'a', nome:'A' }, ctx);
assert.strictEqual(nu.apelido, ''); assert.strictEqual(nu.foto, ''); assert.strictEqual(nu.sexo, '');
assert.strictEqual(nu.ausenciaHtml, ''); assert.strictEqual(nu.acoesHtml, ''); assert.strictEqual(nu.tagsExtraHtml, '');
const ex = montarDadosCard({ id:'a', nome:'A' }, ctx, { ausenciaHtml:'X', temConta:true, posicao:9 });
assert.strictEqual(ex.ausenciaHtml, 'X'); assert.strictEqual(ex.posicao, 9);
console.log('OK — dados do cartão');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/test_card_dados.js"
```
Expected: `TypeError: Cannot read properties of undefined (reading 'split')`.

- [ ] **Step 3: Escrever `contextoCards` e `montarDadosCard`**

Inserir **imediatamente antes** de `function renderPlayers(){` (depois do bloco `// </jogador-card-puro>` da Task 1):

```javascript
// <card-dados>
/* Camada fina entre o app (DATA) e o cartão puro. contextoCards() é chamado UMA vez por render
   (e não uma vez por jogador): computeRanking e computeBadges percorrem todas as rodadas. */
function contextoCards(){
  const posicoes = {};
  computeRanking(new Date().getFullYear().toString()).forEach((r, i)=>{ posicoes[r.id] = i + 1; });
  return { badges: computeBadges(), posicoes, mostrarEstrelas: starsVisibleNow() };
}
function montarDadosCard(p, ctx, extras){
  const s = computePlayerAllTimeStats(p.id);
  const nota = parseFloat(p.estrelas);
  return Object.assign({
    id: p.id, nome: p.nome, apelido: p.apelido || '', foto: p.foto || '', sexo: p.sexo || '',
    temConta: temContaVinculada(p.id),
    emblemasHtml: badgeIconsHtml(p.id, ctx.badges),
    posicao: ctx.posicoes[p.id] || null,                       // sem jogo no ano = sem hexágono
    metricas: s.jogos > 0 ? { partidas: s.jogos, titulos: s.titulos, pct: s.pct } : null,
    estrelas: (ctx.mostrarEstrelas && nota > 0) ? nota : null, // null = oculta pelo admin ou sem nota
    ausenciaHtml: '', tagsExtraHtml: '', acoesHtml: ''
  }, extras || {});
}
// </card-dados>

```

- [ ] **Step 4: Estado dos cartões abertos**

Logo depois de `let EDITING_PLAYER_ID = null; // ...` (~linha 3323) acrescentar:

```javascript
const JOGADOR_CARD_ABERTOS = new Set(); // ids dos cartões da lista que estão expandidos (só na memória)
```

- [ ] **Step 5: Trocar o corpo de `renderPlayers`**

Em `renderPlayers`, substituir estas 3 linhas:

```javascript
  const sorted = sortByName(DATA.players);
  const badges = computeBadges();
  const ultimaVez = computeUltimaParticipacao();
```

por:

```javascript
  const sorted = sortByName(DATA.players);
  const ctxCards = contextoCards();
  const ultimaVez = computeUltimaParticipacao();
```

E substituir **todo** o `return \`...\`;` do `.map` (do `return \`` até o `\`;` antes de `}).join('');`), isto é, este trecho:

```javascript
    return `
    <div class="player-row">
      <div class="with-avatar">
        ${avatarHtml(p)}
        <div>
          <div class="name clickable-name" data-open-profile="${p.id}">${contaVinculadaIconHtml(p.id)}${escapeHtml(p.nome)}${badgeIconsHtml(p.id, badges)}</div>
          ${p.apelido ? `<div class="sub">"${escapeHtml(p.apelido)}"</div>` : ''}
          <div class="meta-row">
            ${starsVisibleNow() ? starsDisplay(p.estrelas) : ''}
            ${p.sexo ? `<span class="badge-gender ${p.sexo}">${p.sexo==='F'?'Feminino':'Masculino'}</span>` : ''}
            ${ausenciaHtml}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:2px;">
        ${podeEditar ? `<button class="icon-btn" data-edit="${p.id}" title="Editar jogador" aria-label="Editar jogador">✏️</button>` : ''}
        ${podeRemover ? `<button class="icon-btn" data-remove="${p.id}" title="Remover" aria-label="Remover jogador">✕</button>` : ''}
      </div>
    </div>
  `;
```

por:

```javascript
    const acoesHtml =
      (podeEditar ? `<button class="icon-btn" data-edit="${p.id}" title="Editar jogador" aria-label="Editar jogador">✏️</button>` : '')
      + (podeRemover ? `<button class="icon-btn" data-remove="${p.id}" title="Remover" aria-label="Remover jogador">✕</button>` : '');
    // sem participações: a própria "ausência" já diz isso e o cartão nasce sem painel de métricas
    return jogadorCardHtml(
      montarDadosCard(p, ctxCards, { ausenciaHtml, acoesHtml }),
      { variante: 'lista', aberto: JOGADOR_CARD_ABERTOS.has(p.id) }
    );
```

(As variáveis `podeEditar`, `podeRemover`, `agora` e `ausenciaHtml` continuam como estão; o resto de `renderPlayers` — os `querySelectorAll('[data-edit]')`, `wireEditPlayerRow()` e `[data-remove]` — **não muda**, pois os botões mantêm os mesmos atributos.)

- [ ] **Step 6: Listener do `>`**

Logo depois do `}` que fecha `function renderPlayers(){ ... }`, acrescentar:

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

- [ ] **Step 7: Rodar testes e validar sintaxe**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/test_card_dados.js"
node "$TMP/test_card.js"
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.argv[1]+'/check_html.js',m[1]);" "$TMP" && node --check "$TMP/check_html.js" && echo "SINTAXE OK"
grep -c "contaVinculadaIconHtml" volei-dashboard.html
```
Expected: `OK — dados do cartão`, `OK — cartão do jogador`, `SINTAXE OK`. O `grep -c` deve continuar acima de 0 (a função ainda é usada no Ranking/outros; **não** remover).

- [ ] **Step 8: Verificação visual (humana — o agente não tem navegador)**

`python3 -m http.server 8000` na pasta (se ainda não estiver rodando) → `http://localhost:8000/volei-dashboard.html` → aba **Jogadores**. Conferir:
1. Cada jogador é um cartão fechado (~90px) com anel neon, hexágono (quem jogou este ano), nome, ícones separados por traços, pílula de sexo e `>`.
2. Tocar no `>`: as métricas abrem com animação suave e a seta gira. Abrir 2–3 cartões, depois editar outro jogador e salvar: os que estavam abertos continuam abertos, sem piscar.
3. Estrelas: escondê-las pelo admin → a coluna de estrelas some (3 colunas).
4. ✏️ e ✕ (logado como organizador/admin) funcionam; clicar no nome abre o perfil.
5. Jogador sem partidas: sem `>` e com "Sem Participações".
6. Modo claro legível; 360px sem rolagem horizontal; métricas em 2×2 nos cartões estreitos.

- [ ] **Step 9: Commit**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
git add volei-dashboard.html
git commit -m "$(cat <<'EOF'
Lista Jogadores: cartão compacto com ">" que expande as métricas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Cartão no Meu Perfil e no modal de perfil (versão 8.6)

**Files:**
- Modify: `volei-dashboard.html` — `renderMeuPerfil` (cabeçalho + grade), `openPlayerProfile` (cabeçalho + grade), rodapé, `#info-changelog`

**Interfaces:**
- Consumes: `contextoCards()`, `montarDadosCard(p, ctx, extras)`, `jogadorCardHtml(d, {variante:'perfil', tituloId})` (Tasks 1–2).

- [ ] **Step 1: Meu Perfil — cabeçalho**

Em `renderMeuPerfil`, substituir a linha de contexto

```javascript
  const badges = computeBadges();
  const parceiros = computeTopPartners(AUTH.jogadorId, 3);
```

por (`badges` continua sendo usado adiante em `ehDesaparecido`/`ehDefunto`, por isso **não** sai):

```javascript
  const badges = computeBadges();
  const ctxCards = contextoCards();
  const parceiros = computeTopPartners(AUTH.jogadorId, 3);
```

E substituir o bloco do cabeçalho:

```javascript
    <div class="profile-head">
      ${player.foto ? `<img class="profile-avatar" src="${player.foto}">` : `<div class="profile-avatar-fallback">${escapeHtml((player.apelido||player.nome||'?').charAt(0).toUpperCase())}</div>`}
      <div>
        <p class="profile-name">${escapeHtml(player.nome)}</p>
        ${player.apelido ? `<div class="sub">"${escapeHtml(player.apelido)}"</div>` : ''}
        <div class="usuario-sub">${escapeHtml(AUTH.email)}</div>
        <div class="profile-badges">${badgeIconsHtml(AUTH.jogadorId, badges)} ${starsVisibleNow()?starsDisplay(player.estrelas):''} ${player.sexo?`<span class="badge-gender ${player.sexo}">${player.sexo==='F'?'Feminino':'Masculino'}</span>`:''}</div>
      </div>
    </div>
```

por:

```javascript
    ${jogadorCardHtml(
      montarDadosCard(player, ctxCards, { temConta: true }), // quem está no Meu Perfil, por definição, tem conta vinculada
      { variante: 'perfil', tituloId: 'meuperfil-titulos-clicavel' }
    )}
    <div class="usuario-sub" style="margin:-6px 0 14px;">${escapeHtml(AUTH.email)}</div>
```

- [ ] **Step 2: Meu Perfil — grade de estatísticas**

O cartão já mostra Partidas, Títulos (com o toque para as datas) e Aproveitamento. Substituir estas 4 linhas da grade:

```javascript
      <div class="profile-stat"><div class="profile-stat-num">${stats.jogos}</div><div class="profile-stat-cap">Rodadas jogadas</div></div>
      <div class="profile-stat"><div class="profile-stat-num ranking-titulos-clicavel" id="meuperfil-titulos-clicavel" title="Toque para ver as datas">${stats.titulos}</div><div class="profile-stat-cap">Vezes campeão</div></div>
      <div class="profile-stat"><div class="profile-stat-num">${stats.vitoriasPartidas}</div><div class="profile-stat-cap"><span class="label-destacado chart-tooltip-trigger" title="Pontos acumulados pela soma de todas as partidas vencidas em cada rodada — mesmo que o time não tenha sido o campeão daquela rodada.">Vitórias</span></div></div>
      <div class="profile-stat"><div class="profile-stat-num">${stats.pct}%</div><div class="profile-stat-cap">Aproveitamento</div></div>
```

por apenas (as linhas de Posição e Sequência logo abaixo **não mudam**):

```javascript
      <div class="profile-stat"><div class="profile-stat-num">${stats.vitoriasPartidas}</div><div class="profile-stat-cap"><span class="label-destacado chart-tooltip-trigger" title="Pontos acumulados pela soma de todas as partidas vencidas em cada rodada — mesmo que o time não tenha sido o campeão daquela rodada.">Vitórias</span></div></div>
```

O listener `document.getElementById('meuperfil-titulos-clicavel')` mais abaixo **não muda**: o id agora vive dentro do cartão.

- [ ] **Step 3: Modal de perfil — cabeçalho**

Em `openPlayerProfile`, substituir

```javascript
  const badges = computeBadges();
  const parceiros = computeTopPartners(id, 3);
```

por

```javascript
  const ctxCards = contextoCards();
  const parceiros = computeTopPartners(id, 3);
```

(`badges` só era usado no cabeçalho que está saindo; conferir com `grep` no Step 5.) E substituir o bloco

```javascript
      <div class="profile-head">
        ${player.foto ? `<img class="profile-avatar" src="${player.foto}">` : `<div class="profile-avatar-fallback">${escapeHtml((player.apelido||player.nome||'?').charAt(0).toUpperCase())}</div>`}
        <div>
          <p class="profile-name">${escapeHtml(player.nome)}</p>
          ${player.apelido ? `<div class="sub">"${escapeHtml(player.apelido)}"</div>` : ''}
          <div class="profile-badges">${badgeIconsHtml(id, badges)} ${starsVisibleNow()?starsDisplay(player.estrelas):''} ${player.sexo?`<span class="badge-gender ${player.sexo}">${player.sexo==='F'?'Feminino':'Masculino'}</span>`:''} ${player.porte?`<span class="porte-badge">${svgSaltador(player.porte, 0.5)} ${labelPorte(player.porte)}</span>`:''}</div>
        </div>
      </div>
```

por:

```javascript
      ${jogadorCardHtml(
        montarDadosCard(player, ctxCards, {
          // o emblema de porte já existia ao lado do sexo no cabeçalho antigo — não pode sumir
          tagsExtraHtml: player.porte ? `<span class="porte-badge">${svgSaltador(player.porte, 0.5)} ${labelPorte(player.porte)}</span>` : ''
        }),
        { variante: 'perfil', tituloId: 'profile-fotos-clicavel' }
      )}
```

- [ ] **Step 4: Modal de perfil — grade**

Substituir a abertura da grade **junto com** as 4 linhas (o `<div class="profile-stats-grid">` do modal tem 6 espaços de indentação; incluí-lo no trecho é o que o torna único em relação ao do Meu Perfil, que tem 4):

```javascript
      <div class="profile-stats-grid">
        <div class="profile-stat"><div class="profile-stat-num">${stats.jogos}</div><div class="profile-stat-cap">Rodadas jogadas</div></div>
        <div class="profile-stat"><div class="profile-stat-num ranking-titulos-clicavel" id="profile-fotos-clicavel" title="Toque para ver as datas">${stats.vezesNaFoto}</div><div class="profile-stat-cap">Vezes na foto</div></div>
        <div class="profile-stat"><div class="profile-stat-num">${stats.vitoriasPartidas}</div><div class="profile-stat-cap"><span class="label-destacado chart-tooltip-trigger" title="Pontos acumulados pela soma de todas as partidas vencidas em cada rodada — mesmo que o time não tenha sido o campeão daquela rodada.">Vitórias</span></div></div>
        <div class="profile-stat"><div class="profile-stat-num">${stats.pct}%</div><div class="profile-stat-cap">Aproveitamento</div></div>
```

por (sobra só "Vitórias", então a grade vira uma coluna; a grade do `renderMeuPerfil` **não** ganha esse estilo):

```javascript
      <div class="profile-stats-grid" style="grid-template-columns:1fr;">
        <div class="profile-stat"><div class="profile-stat-num">${stats.vitoriasPartidas}</div><div class="profile-stat-cap"><span class="label-destacado chart-tooltip-trigger" title="Pontos acumulados pela soma de todas as partidas vencidas em cada rodada — mesmo que o time não tenha sido o campeão daquela rodada.">Vitórias</span></div></div>
```

- [ ] **Step 5: Conferir referências soltas**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
sed -n '/^function openPlayerProfile/,/^function closePlayerProfile/p' volei-dashboard.html | grep -n "badges\b" ; echo "(acima: deve estar vazio)"
grep -c 'id="meuperfil-titulos-clicavel"\|id="profile-fotos-clicavel"' volei-dashboard.html
```
Expected: nenhum uso de `badges` dentro de `openPlayerProfile`; os dois ids aparecem só como `tituloId:` (o `grep -c` de `id="..."` literal deve dar `0` — os ids agora vêm da função pura; confirmar no teste do Step 6).

- [ ] **Step 6: Versão e changelog**

Rodapé `Ver.: 8.5 ·` → `Ver.: 8.6 ·`. Em `#info-changelog`, inserir **antes** da entrada v8.5 uma nova entrada com `open` e **remover** o `open` da v8.5:

```html
        <details class="dash-accordion" open>
          <summary>18/09/2026 — v8.6: Cartão do jogador</summary>
          <div>
            <p style="line-height:1.6;">Jogadores agora aparecem em <strong>cartões</strong> com anel neon no avatar, hexágono com a posição no ranking do ano e emblemas separados. Na lista <strong>Jogadores</strong> o cartão vem compacto: toque no <strong>&gt;</strong> para ver Partidas, Títulos, Aproveitamento e Estrelas.</p>
            <p style="line-height:1.6;">O mesmo cartão abre o <strong>Meu Perfil</strong> e o perfil de cada jogador. Se o administrador esconder as estrelas, a coluna de estrelas some.</p>
          </div>
        </details>

        <details class="dash-accordion">
          <summary>18/09/2026 — v8.5: Título "Ao Vivo" pulsando</summary>
```

(o segundo `<details>` acima é a v8.5 já existente, só sem o `open`.)

- [ ] **Step 7: Rodar todos os testes e validar sintaxe**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
TMP="C:/Users/Heleno/AppData/Local/Temp/claude"
node "$TMP/test_card.js" && node "$TMP/test_card_dados.js" && node "$TMP/test_som.js" && node "$TMP/test_podio.js" && node "$TMP/test_radar.js"
node -e "const fs=require('fs');const c=fs.readFileSync('volei-dashboard.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.argv[1]+'/check_html.js',m[1]);" "$TMP" && node --check "$TMP/check_html.js" && echo "SINTAXE OK"
grep -o "Ver\.: [0-9.]*" volei-dashboard.html
```
Expected: 5 linhas `OK — ...`, `SINTAXE OK` e `Ver.: 8.6`.

- [ ] **Step 8: Verificação visual (humana)**

Em `http://localhost:8000/volei-dashboard.html` (logado, com jogador vinculado):
1. **Meu Perfil:** cartão sempre aberto, sem `>`; em tela larga as 4 métricas em fila (igual à imagem); no celular/estreito, 2×2. Tocar no número de **Títulos** abre as datas de campeão. Vitórias/Posição/Sequência continuam na grade abaixo; o e-mail aparece logo abaixo do cartão.
2. **Modal de perfil** (tocar no nome de um jogador na lista ou no Ranking): cartão completo dentro do modal, com o emblema de *porte* preservado quando existir; tocar em Títulos abre as datas; clicar no nome **não** abre um segundo perfil.
3. Modo claro e 360px legíveis; sem rolagem horizontal.
4. Jogador sem partidas: cartão sem métricas, sem erro no console.

- [ ] **Step 9: Commit**

```bash
cd "c:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS"
git add volei-dashboard.html
git commit -m "$(cat <<'EOF'
Cartão do jogador no Meu Perfil e no modal de perfil (v8.6)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Depois deste plano

Conforme o CLAUDE.md: **parar aqui** e mostrar o resultado só no Terça. O Meme só recebe o cartão depois de autorização explícita, pelo mesmo procedimento da réplica anterior: merge de 3 vias (base = Terça antes do cartão; `git show <commit-base>:volei-dashboard.html`, versão LF) com o `volei-meme-dashboard.html`. Como o cartão é todo feito de tokens (`--accent`, `--neon-purple`, `--glass-*`), o Meme só precisa de ajuste de texto/comentários. Sem mudança de backend: nenhuma aba nova nem `.gs` a reimplantar.

Ponto para decidir depois (registrado, não implementado): na lista fechada a **nota em estrelas** deixa de aparecer de relance (ela vive na coluna "Estrelas" do painel aberto). Quem usa a lista para conferir notas terá que expandir. Se isso incomodar, uma alternativa barata é mostrar as 5 estrelinhas pequenas na linha de tags do cartão fechado, só para quem `starsVisibleNow()`.
