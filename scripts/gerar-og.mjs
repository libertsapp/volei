// Gera as imagens de prévia do link (og-*.jpg, 1200×630, ~60 KB) a partir de scripts/og-imagem.html, em JPEG, pelo
// protocolo de depuração do Chrome (Page.captureScreenshot) — sem instalar nada. O WhatsApp ignora prévias muito pesadas,
// por isso JPEG e não o PNG do --screenshot. Uso (Git Bash, na raiz):
//   node scripts/gerar-og.mjs "C:/Program Files/Google/Chrome/Application/chrome.exe" "$(cygpath -m "$PWD/scripts/og-imagem.html")" //     "og-terca.jpg=endereco=memberstars.com/volei" "og-grupos.jpg=titulo=...&frase=...&endereco=volei.memberstars.com&selo=MemberStars"
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [,, chrome, modelo, ...pares] = process.argv; // pares: saida=query
const perfil = process.env.TEMP + '/og-chrome-perfil';
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9333', '--user-data-dir=' + perfil, '--window-size=1200,630', 'about:blank']);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let alvo;
for (let i = 0; i < 40 && !alvo; i++) { await espera(250); try { alvo = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let n = 0; const pend = {};
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m.result); delete pend[m.id]; } });
const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; pend[id] = r; ws.send(JSON.stringify({ id, method, params })); });
await cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
for (const par of pares) {
  const [saida, query] = par.split('=', 2).length === 2 ? [par.slice(0, par.indexOf('=')), par.slice(par.indexOf('=') + 1)] : [par, ''];
  await cmd('Page.navigate', { url: 'file:///' + modelo + (query ? '?' + query : '') });
  await espera(3500); // fontes do Google
  const { data } = await cmd('Page.captureScreenshot', { format: 'jpeg', quality: 84, clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
  fs.writeFileSync(saida, Buffer.from(data, 'base64'));
  console.log(saida, fs.statSync(saida).size, 'bytes');
}
ws.close(); proc.kill();
