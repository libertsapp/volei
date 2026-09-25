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
  devolverCredito:    ['admin']
};
