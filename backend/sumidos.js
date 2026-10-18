// 👻 Sumidos no servidor (v20.0): a MESMA regra da tela "Sumidos" do app (computeSumidos, bloco <sumidos-retro> do
// volei-dashboard.html), para o aviso automático de "sentimos sua falta" quando o check-in abre. Sumido = jogou pelo
// menos SUMIDOS_MIN_JOGOS datas, faltou as últimas SUMIDOS_MIN_FALTAS datas de jogo do grupo e a última vez dele foi há
// no máximo SUMIDOS_MAX_DIAS dias (depois disso já é quem parou). Conta por DATA (dois jogos no dia = um dia de vôlei).
// Quem levou 🚫 falta numa data não "jogou" aquela data (mesma regra da v19.3). Função pura: t = repo.lerTudo().
import { mapearRodadas, mapearJogadores, mapearCheckins } from './mapeadores.js';

export const SUMIDOS_MIN_FALTAS = 3;
export const SUMIDOS_MIN_JOGOS = 4;
export const SUMIDOS_MAX_DIAS = 180;

const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

export function computeSumidos(t, hojeIso) {
  const rodadas = mapearRodadas(t.rodadas, t.times_rodada, t.time_jogadores).filter((r) => !r.rascunho && r.data <= hojeIso);
  const faltou = new Set(), foi = new Set(); // 'data|id' (falta só vale se faltou TODOS os check-ins da data)
  for (const c of mapearCheckins(t.checkins || [])) {
    if (!c.jogadorId) continue;
    (c.faltou ? faltou : foi).add(c.data + '|' + c.jogadorId);
  }
  const datasGrupo = [...new Set(rodadas.map((r) => r.data))].sort();
  const jogouPorId = {};
  for (const r of rodadas) {
    for (const time of r.times) {
      for (const id of time.playerIds || []) {
        if (!id) continue;
        const k = r.data + '|' + id;
        if (faltou.has(k) && !foi.has(k)) continue;
        (jogouPorId[id] || (jogouPorId[id] = new Set())).add(r.data);
      }
    }
  }
  const out = [];
  for (const p of mapearJogadores(t.jogadores)) {
    const jogou = jogouPorId[p.id];
    if (!jogou || jogou.size < SUMIDOS_MIN_JOGOS) continue;
    const ultima = [...jogou].sort().pop();
    const faltas = datasGrupo.length - 1 - datasGrupo.indexOf(ultima);
    const dias = diasEntre(ultima, hojeIso);
    if (faltas < SUMIDOS_MIN_FALTAS || dias > SUMIDOS_MAX_DIAS) continue;
    out.push({ id: p.id, nome: p.apelido || p.nome, ultima, faltas, dias });
  }
  return out;
}
