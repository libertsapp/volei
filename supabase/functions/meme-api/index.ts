// Edge Function do backend do Vôlei Meme Brasil (Deno). Mesma casca da terca-api-teste, mas: schema "meme" do banco,
// bucket "fotos-meme" e segredos com prefixo MEME_ (os segredos das funções são do projeto inteiro, então não podem colidir com os do Terça).
// Os módulos de ./backend/ são gerados por "npm run preparar-edge -- meme-api" (cópia de backend/*.js).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { criarHandler } from './backend/handler.js';
import { criarEdge } from './backend/edge.js';
import { criarRepoSupabase } from './backend/repo-supabase.js';
import { criarArmazenamentoSupabase } from './backend/armazenamento-supabase.js';
import { criarVerificadorGoogle } from './backend/auth.js';
import { criarLimitador } from './backend/limitador.js';

const NOMES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MEME_ADMIN_PASSWORD', 'GOOGLE_CLIENT_ID', 'MEME_ORIGENS_PERMITIDAS'];
const env = (nome: string): string => (Deno.env.get(nome) ?? '').trim();
const faltando = NOMES.filter((nome) => !env(nome));
if (faltando.length) console.error('Faltam variáveis de ambiente na função: ' + faltando.join(', '));
const senhaCurta = env('MEME_ADMIN_PASSWORD') !== '' && env('MEME_ADMIN_PASSWORD').length < 20;
if (senhaCurta) console.error('MEME_ADMIN_PASSWORD tem menos de 20 caracteres: use uma senha longa e aleatória.');

const recusar = (): Response => new Response(JSON.stringify({ error: 'Configuração incompleta no servidor.' }), {
  status: 500, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

if (faltando.length || senhaCurta) {
  Deno.serve(recusar); // nunca sobe "meio configurada": toda requisição recebe 500
} else {
  const cliente = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }, // função sem sessão: nada a guardar nem renovar
    db: { schema: 'meme' }
  });
  const registrar = (erro: unknown) => console.error('erro inesperado:', erro instanceof Error ? erro.message : 'desconhecido');
  const repo = criarRepoSupabase(cliente);
  const handler = criarHandler({
    repo,
    armazenamento: criarArmazenamentoSupabase({ cliente, urlBase: env('SUPABASE_URL'), bucket: 'fotos-meme' }),
    config: { adminPassword: env('MEME_ADMIN_PASSWORD') },
    verificarToken: criarVerificadorGoogle({ clientId: env('GOOGLE_CLIENT_ID') }),
    limitador: criarLimitador({ repo }),
    avisar: (...a: unknown[]) => console.error(...a),
    ocultarErrosInternos: true, // cliente anônimo nunca vê texto de banco; a mensagem real vai só para o log
    registrar
  });
  Deno.serve(criarEdge({
    handler,
    origensPermitidas: env('MEME_ORIGENS_PERMITIDAS').split(','),
    registrar
  }));
}
