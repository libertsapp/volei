// Edge Function dos grupos independentes (Deno). Atende QUALQUER grupo criado pela página /criar: o grupo vem do apelido
// ("?g=" no GET, campo "grupo" no POST). Dados de todos os grupos no schema "grupos" (separados por grupo_id) e amistosos
// no schema "liga". Os módulos de ./backend/ são gerados por "npm run preparar-edge -- grupos-api" (cópia de backend/*.js).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { criarGruposApi } from './backend/grupos-api.js';
import { criarEdge } from './backend/edge.js';
import { criarRepoMultigrupo } from './backend/repo-multigrupo.js';
import { criarCadastroSupabase } from './backend/cadastro-grupos.js';
import { criarRepoLigaSupabase } from './backend/repo-liga-supabase.js';
import { criarArmazenamentoSupabase } from './backend/armazenamento-supabase.js';
import { criarVerificadorGoogle } from './backend/auth.js';

const NOMES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_ID', 'GRUPOS_ORIGENS_PERMITIDAS'];
const env = (nome: string): string => (Deno.env.get(nome) ?? '').trim();
const faltando = NOMES.filter((nome) => !env(nome));
if (faltando.length) console.error('Faltam variáveis de ambiente na função: ' + faltando.join(', '));

const recusar = (): Response => new Response(JSON.stringify({ error: 'Configuração incompleta no servidor.' }), {
  status: 500, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

if (faltando.length) {
  Deno.serve(recusar); // nunca sobe "meio configurada"
} else {
  const opcoes = (schema: string) => ({ auth: { persistSession: false, autoRefreshToken: false }, db: { schema } });
  const clienteGrupos = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), opcoes('grupos'));
  const clienteLiga = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), opcoes('liga'));
  const registrar = (erro: unknown) => console.error('erro inesperado:', erro instanceof Error ? erro.message : 'desconhecido');
  // notificações push: opcionais (mesmas chaves VAPID do Terça e do Meme); sem elas o resto funciona normal
  const vapidPub = env('VAPID_PUBLIC_KEY'), vapidPriv = env('VAPID_PRIVATE_KEY');
  if (vapidPub && vapidPriv) webpush.setVapidDetails(env('GRUPOS_ORIGENS_PERMITIDAS').split(',')[0], vapidPub, vapidPriv);
  const enviarPush = (vapidPub && vapidPriv)
    ? async (insc: { endpoint: string; p256dh: string; auth: string }, payload: string) =>
        webpush.sendNotification({ endpoint: insc.endpoint, keys: { p256dh: insc.p256dh, auth: insc.auth } }, payload)
    : undefined;
  const api = criarGruposApi({
    cadastro: criarCadastroSupabase(clienteGrupos),
    criarRepoDoGrupo: (grupoId: string) => criarRepoMultigrupo(clienteGrupos, grupoId),
    armazenamentoBase: criarArmazenamentoSupabase({ cliente: clienteGrupos, urlBase: env('SUPABASE_URL'), bucket: 'fotos-grupos' }),
    repoLiga: criarRepoLigaSupabase(clienteLiga),
    verificarToken: criarVerificadorGoogle({ clientId: env('GOOGLE_CLIENT_ID') }),
    enviarPush,
    avisar: (...a: unknown[]) => console.error(...a),
    ocultarErrosInternos: true, // cliente anônimo nunca vê texto de banco
    registrar
  });
  Deno.serve(criarEdge({ handler: api, origensPermitidas: env('GRUPOS_ORIGENS_PERMITIDAS').split(','), registrar }));
}
