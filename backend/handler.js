import {
  mapearJogadores, mapearRodadas, mapearConfig, mapearCheckins,
  mapearPerfisPublicos, mapearAoVivo, mapearFinanceiro
} from './mapeadores.js';

// Handler do backend: mesma cara do doGet/doPost do Apps Script. Recebe o repositório por
// injeção (memória nos testes, Supabase de verdade no servidor local e na Edge Function).
export function criarHandler({ repo }) {
  return {
    async get() {
      try {
        const t = await repo.lerTudo();
        return {
          players: mapearJogadores(t.jogadores),
          rounds: mapearRodadas(t.rodadas, t.times_rodada, t.time_jogadores),
          settings: mapearConfig(t.config),
          checkins: mapearCheckins(t.checkins),
          perfisPublicos: mapearPerfisPublicos(t.usuarios),
          aoVivo: mapearAoVivo(t.ao_vivo, t.ao_vivo_log),
          financeiro: mapearFinanceiro(t)
        };
      } catch (erro) {
        return { error: String(erro && erro.message ? erro.message : erro) };
      }
    },

    // Etapa 1: só leitura. As ações de escrita chegam nas próximas etapas.
    async post(body) {
      const acao = body && body.action;
      if (acao === 'incrementarAcesso') {
        const t = await repo.lerTudo();
        return { contadorAcessos: mapearConfig(t.config).contadorAcessos };
      }
      return { error: 'Esta ação ainda não está disponível na versão Supabase (' + String(acao) + ').' };
    }
  };
}
