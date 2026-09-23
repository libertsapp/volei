// Planilha + Apps Script FALSOS, só o suficiente pra rodar os .gs reais dentro do Node (vm).
// Assim os testes exercitam o código de verdade (doGet/doPost/autorizar_) sem Google.
const fs = require('fs');
const vm = require('vm');

class AbaFalsa {
  constructor(nome, linhas){ this.nome = nome; this.linhas = (linhas || []).map(l => l.slice()); }
  getDataRange(){
    const larg = Math.max(1, ...this.linhas.map(l => l.length));
    return { getValues: () => this.linhas.map(l => { const c = l.slice(); while(c.length < larg) c.push(''); return c; }) };
  }
  appendRow(l){ this.linhas.push(l.slice()); }
  getLastRow(){ return this.linhas.length; }
  deleteRow(n){ this.linhas.splice(n - 1, 1); }
  clearContents(){ this.linhas = []; }
  _set(linha, col, v){
    while(this.linhas.length < linha) this.linhas.push([]);
    const l = this.linhas[linha - 1];
    while(l.length < col) l.push('');
    l[col - 1] = v;
  }
  getRange(a, b, c, d){
    if(typeof a === 'string') return { setNumberFormat(){} };   // 'A:C' etc.: formato não importa no teste
    const linha = a, col = b, nl = c || 1, nc = d || 1, self = this;
    return {
      setValue(v){ self._set(linha, col, v); },
      getValue(){ const l = self.linhas[linha - 1] || []; const v = l[col - 1]; return v === undefined ? '' : v; },
      setValues(m){ m.forEach((row, i) => row.forEach((v, j) => self._set(linha + i, col + j, v))); },
      getValues(){
        const out = [];
        for(let i = 0; i < nl; i++){
          const l = self.linhas[linha - 1 + i] || [], row = [];
          for(let j = 0; j < nc; j++) row.push(l[col - 1 + j] === undefined ? '' : l[col - 1 + j]);
          out.push(row);
        }
        return out;
      },
      setNumberFormat(){}
    };
  }
}

/* abasIniciais: { NomeDaAba: [[linha1], [linha2], ...] }   arquivosGs: caminhos dos .gs a carregar, em ordem */
function criarAmbiente(abasIniciais, arquivosGs){
  const abas = {};
  Object.keys(abasIniciais || {}).forEach(n => { abas[n] = new AbaFalsa(n, abasIniciais[n]); });
  const planilha = {
    getSheetByName: (n) => abas[n] || null,
    insertSheet: (n) => (abas[n] = new AbaFalsa(n, []))
  };
  let seq = 0;
  const sandbox = {
    console,
    // o Terça é vinculado à planilha (getActiveSpreadsheet); o Meme é script avulso e abre por ID (openById)
    SpreadsheetApp: { getActiveSpreadsheet: () => planilha, openById: () => planilha },
    Utilities: {
      formatDate: (d) => d.toISOString().slice(0, 10),
      getUuid: () => 'uuid-' + (++seq),
      base64Decode: () => []
    },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Logger: { log(){} },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ conteudo: t, setMimeType(){ return this; }, getContent(){ return this.conteudo; } })
    },
    LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){} }) },
    UrlFetchApp: { fetch(){ throw new Error('sem rede no teste'); } },
    DriveApp: {}
  };
  const ctx = vm.createContext(sandbox);
  arquivosGs.forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));
  const rodar = (codigo) => vm.runInContext(codigo, ctx);
  return {
    abas, rodar,
    post: (body) => JSON.parse(rodar('doPost')({ postData: { contents: JSON.stringify(body) } }).getContent()),
    get: () => JSON.parse(rodar('doGet')({}).getContent())
  };
}

module.exports = { criarAmbiente, AbaFalsa };
