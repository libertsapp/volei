// MATRIZ DE PERMISSÕES — qual perfil pode fazer qual ação (cópia fiel de PERMISSOES + PERMISSOES_FIN_ do .gs).
// Lista branca: ação que não estiver aqui é recusada. Quem não logou é tratado como 'jogador'.
// 'updatePlayer' não lista 'jogador' de propósito: a exceção "jogador troca a PRÓPRIA foto" chega na etapa 3.
export const PERMISSOES = {
  ping:             ['jogador', 'organizador', 'admin'],
  uploadPhoto:      ['jogador', 'organizador', 'admin'],
  addPlayer:        ['organizador', 'admin'],
  updatePlayer:     ['organizador', 'admin'],
  addRound:         ['organizador', 'admin'],
  updateRound:      ['organizador', 'admin'],
  removePlayer:     ['admin'],
  restorePlayer:    ['organizador', 'admin'], // só existe no backend novo: o .gs apaga a linha e não tem como restaurar
  removeRound:      ['admin'],
  saveSettings:       ['admin'],
  saveCheckinSettings: ['organizador', 'admin'],
  listarUsuarios:   ['organizador', 'admin'],
  salvarUsuario:    ['admin'],
  removerUsuario:   ['admin'],
  solicitarVinculo: ['jogador', 'organizador', 'admin'],
  aprovarVinculo:   ['organizador', 'admin'],
  rejeitarVinculo:  ['organizador', 'admin'],
  salvarEstrelasAjustadas: ['organizador', 'admin'],
  iniciarTransmissaoAoVivo:  ['organizador', 'admin'],
  salvarParcialAoVivo:       ['organizador', 'admin'],
  cancelarTransmissaoAoVivo: ['organizador', 'admin'],
  // dois jogos no mesmo dia (2026-10-03)
  moverCheckin:       ['organizador', 'admin'],
  salvarJogo2:        ['organizador', 'admin'],
  removerJogo2:       ['organizador', 'admin'],
  // controle financeiro
  salvarFinDia:       ['organizador', 'admin'],
  marcarPagamento:    ['organizador', 'admin'],
  estornarPagamento:  ['organizador', 'admin'],
  marcarTodosPagamentos:    ['organizador', 'admin'],
  estornarTodosPagamentos:  ['organizador', 'admin'],
  addLancamento:      ['organizador', 'admin'],
  estornarLancamento: ['admin'],
  marcarDiaSemJogo:   ['organizador', 'admin'],
  reabrirDia:         ['organizador', 'admin'],
  aplicarCreditosDoDia: ['organizador', 'admin'],
  devolverCredito:    ['admin'],
  addPendencia:       ['organizador', 'admin'],
  baixarPendencia:    ['organizador', 'admin'],
  // amistosos entre grupos (2026-10-12). entrarAmistoso/sairAmistoso ficam FORA da matriz de propósito: são como o
  // check-in (só pedem login, qualquer perfil) e o handler trata antes do porteiro
  convidarGrupo:        ['organizador', 'admin'],
  responderConvite:     ['organizador', 'admin'],
  cancelarAmistoso:     ['organizador', 'admin'],
  recadoAmistoso:       ['organizador', 'admin'],
  confirmarEscalado:    ['organizador', 'admin'],
  desconfirmarEscalado: ['organizador', 'admin'],
  travarEscalacao:      ['organizador', 'admin'],
  destravarEscalacao:   ['organizador', 'admin'],
  lancarPlacar:         ['organizador', 'admin'],
  confirmarPlacar:      ['organizador', 'admin'],
  contestarPlacar:      ['organizador', 'admin'],
  enviarNotificacao:  ['organizador', 'admin']
};
