// Erro lançado DE PROPÓSITO com texto pensado para o usuário. Na Edge Function (ocultarErrosInternos) só ele mantém a
// mensagem; qualquer outra exceção (texto de banco, Storage, TypeError...) vira "Erro interno no servidor." e a mensagem real
// só vai para o log. Hoje o backend não lança nenhum (as mensagens de negócio são devolvidas como { error }); a classe existe
// para quando alguém precisar lançar uma.
export class ErroDeNegocio extends Error {}
export const MSG_ERRO_INTERNO = 'Erro interno no servidor.';
