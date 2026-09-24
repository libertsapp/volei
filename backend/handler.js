import {
  mapearJogadores, mapearRodadas, mapearConfig, mapearCheckins,
  mapearPerfisPublicos, mapearAoVivo, mapearFinanceiro
} from './mapeadores.js';
import { autorizar } from './porteiro.js';
import {
  loginGoogle, bootstrapAdmin, listarUsuarios, salvarUsuario, removerUsuario,
  solicitarVinculo, aprovarVinculo, rejeitarVinculo
} from './usuarios.js';
import { addPlayer, updatePlayer, removePlayer } from './jogadores.js';
import { addRound, updateRound, removeRound } from './rodadas.js';
import { saveSettings } from './configuracoes.js';
import { uploadPhoto } from './fotos.js';
import { addCheckin, removeCheckin, salvarEstrelasAjustadas } from './checkins.js';
import {
  salvarFinDia, marcarPagamento, estornarPagamento, marcarTodosPagamentos, estornarTodosPagamentos,
  addLancamento, estornarLancamento, marcarDiaSemJogo, reabrirDia, aplicarCreditosDoDia, devolverCredito
} from './financeiro.js';
import { comTrava } from './trava.js';

const naoDisponivel = (acao) => ({ error: 'Esta ação ainda não está disponível na versão Supabase (' + acao + ').' });
const semLogin = async () => ({ ok: false, erro: 'Login do Google não configurado neste servidor.' });

// Handler do backend: mesma cara do doGet/doPost do Apps Script. Tudo entra por injeção: o repositório
// (memória nos testes, Supabase de verdade no servidor e na Edge Function), a chave mestra, o verificador
// do token do Google e o relógio.
export function criarHandler({ repo, config = {}, verificarToken = semLogin, relogio = () => new Date(), armazenamento, gerarId, gerarDono = () => globalThis.crypto.randomUUID(), esperar }) {
  // gerarDono: dono da trava de gravação (separado de gerarId para não gastar ids de registros); esperar: pausa entre tentativas da trava
  const deps = { repo, config, verificarToken, relogio, armazenamento, gerarId, gerarDono, esperar };
  // trava única 'gravacao' (o LockService do .gs): as ações do financeiro e o check-in (com seus ganchos) nunca se misturam.
  // As demais gravações (jogadores, rodadas, configurações, fotos) NÃO usam a trava hoje: para incluí-las, é só trocar
  // `return await acao(...)` por `return await travar(() => acao(...))` no case dela (uma linha por ação).
  const travar = (fn) => comTrava(deps, 'gravacao', fn);

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

    // Mesmas regras do doPost do .gs: ações públicas primeiro, depois o porteiro, depois a ação.
    async post(body) {
      try {
        const b = body || {};
        const acao = String(b.action || '');

        if (acao === 'incrementarAcesso') { // etapa 1: só lê o contador; gravar é da etapa 5
          const t = await repo.lerTudo();
          return { contadorAcessos: mapearConfig(t.config).contadorAcessos };
        }
        if (acao === 'lerAoVivo') {
          const t = await repo.lerTudo();
          return mapearAoVivo(t.ao_vivo, t.ao_vivo_log);
        }
        if (acao === 'loginGoogle') return await loginGoogle(deps, b);
        if (acao === 'bootstrapAdmin') return await bootstrapAdmin(deps, b);

        // check-in não pede senha nem perfil, só login (a chave mestra sozinha NÃO vale, como no .gs)
        if (acao === 'addCheckin' || acao === 'removeCheckin') {
          const token = await verificarToken(b.idToken);
          if (!token.ok) return { error: token.erro };
          // os ganchos do financeiro rodam dentro de addCheckin/removeCheckin, sob a mesma trava
          return await travar(() => (acao === 'addCheckin' ? addCheckin(deps, b.checkin) : removeCheckin(deps, b.id)));
        }

        // daqui pra baixo é tudo sensível: passa pelo porteiro (chave mestra OU login do Google)
        const auth = await autorizar(deps, b);
        if (auth.error) return { error: auth.error };

        switch (acao) {
          case 'ping': return { status: 'ok', perfil: auth.perfil, viaChaveMestra: !!auth.viaChaveMestra };
          case 'listarUsuarios': return await listarUsuarios(deps, auth.perfil);
          case 'salvarUsuario': return await salvarUsuario(deps, b.usuario);
          case 'removerUsuario': return await removerUsuario(deps, b.email);
          case 'solicitarVinculo': return await solicitarVinculo(deps, auth, b.jogadorId);
          case 'aprovarVinculo': return await aprovarVinculo(deps, b.email, b.jogadorId);
          case 'rejeitarVinculo': return await rejeitarVinculo(deps, b.email);
          case 'uploadPhoto': return await uploadPhoto(deps, auth, b);
          case 'addPlayer': return await addPlayer(deps, b.player);
          case 'updatePlayer': return await updatePlayer(deps, b.player);
          case 'removePlayer': return await removePlayer(deps, b.id);
          case 'addRound': return await addRound(deps, b.round);
          case 'updateRound': return await updateRound(deps, b.round);
          case 'removeRound': return await removeRound(deps, b.id);
          case 'saveSettings':
          case 'saveCheckinSettings': return await saveSettings(deps, b.settings);
          case 'salvarEstrelasAjustadas': return await salvarEstrelasAjustadas(deps, b.checkins);
          // controle financeiro (etapas 4a e 4b): toda gravação sob a trava 'gravacao'
          case 'salvarFinDia': return await travar(() => salvarFinDia(deps, b.dia, auth));
          case 'marcarPagamento': return await travar(() => marcarPagamento(deps, b.data, b.jogadorId, b.jogadorNome, auth));
          case 'estornarPagamento': return await travar(() => estornarPagamento(deps, b.id, auth));
          case 'marcarTodosPagamentos': return await travar(() => marcarTodosPagamentos(deps, b.data, auth));
          case 'estornarTodosPagamentos': return await travar(() => estornarTodosPagamentos(deps, b.data, auth));
          case 'addLancamento': return await travar(() => addLancamento(deps, b.lancamento, auth));
          case 'estornarLancamento': return await travar(() => estornarLancamento(deps, b.id, auth));
          case 'marcarDiaSemJogo': return await travar(() => marcarDiaSemJogo(deps, b.data, b.destino, auth));
          case 'reabrirDia': return await travar(() => reabrirDia(deps, b.data, auth));
          case 'aplicarCreditosDoDia': return await travar(() => aplicarCreditosDoDia(deps, b.data, auth));
          case 'devolverCredito': return await travar(() => devolverCredito(deps, b.id, auth));
          default: return naoDisponivel(acao);
        }
      } catch (erro) {
        return { error: String(erro && erro.message ? erro.message : erro) };
      }
    }
  };
}
