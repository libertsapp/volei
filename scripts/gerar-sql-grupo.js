// Gera o SQL de um grupo (schema separado no MESMO projeto Supabase) a partir dos SQL do Terça, para os dois nunca divergirem.
// Só troca NOME DE SCHEMA ("set search_path = public" e "'public.tabela'" em regclass). O "public" de
// "revoke ... from public, anon, authenticated" é o PAPEL PUBLIC do Postgres e NÃO é trocado.
// Uso: npm run gerar-sql-meme   -> escreve sql/meme/schema-meme-supabase.sql (um arquivo só, para colar de uma vez no SQL Editor).
// Não toca em rede nem no banco.
const fs = require('node:fs');
const path = require('node:path');

const ARQUIVOS_DO_TERCA = [
  'schema-terca-supabase.sql',
  'schema-terca-supabase-ajuste-1.sql',
  'schema-terca-supabase-ajuste-2.sql',
  'schema-terca-supabase-ajuste-3.sql',
  'schema-terca-supabase-ajuste-4.sql',
  'schema-terca-supabase-ajuste-5.sql',
  'schema-terca-supabase-ajuste-6.sql',
  'schema-terca-supabase-ajuste-7.sql',
  'schema-terca-supabase-ajuste-8.sql',
  'schema-terca-supabase-ajuste-9.sql',
  'schema-terca-supabase-ajuste-10.sql'
];

function trocarSchema(sql, schema) {
  return sql
    .replace(/set search_path = public\b/g, `set search_path = ${schema}`)
    .replace(/'public\./g, `'${schema}.`);
}

function cabecalho(schema) {
  return [
    `-- GERADO por scripts/gerar-sql-grupo.js a partir dos SQL do Terça. NÃO edite: rode "npm run gerar-sql-${schema}" de novo.`,
    `-- Cria o schema "${schema}" no MESMO projeto do Terça (o schema "public" do Terça não é tocado).`,
    '-- QUEM RODA: o usuário, UMA vez, no SQL Editor do Supabase. Depois: Configurações > API > "Exposed schemas": acrescentar o schema.',
    `create schema if not exists ${schema};`,
    `set search_path to ${schema};`,
    ''
  ].join('\n');
}

function rodape(schema) {
  return [
    '',
    '-- ==== acesso e search_path (gerado) ====',
    '-- funções que não fixavam search_path passam a apontar para este schema, sem depender da requisição:',
    `alter function gravar_rodada(jsonb) set search_path = ${schema};`,
    `alter function remover_rodada(text) set search_path = ${schema};`,
    '-- só service_role acessa o schema (o app nunca fala com o banco direto):',
    `grant usage on schema ${schema} to service_role;`,
    `grant all on all tables in schema ${schema} to service_role;`,
    `grant all on all sequences in schema ${schema} to service_role;`,
    `grant execute on all functions in schema ${schema} to service_role;`,
    `revoke all on all tables in schema ${schema} from anon, authenticated;`,
    `revoke all on all sequences in schema ${schema} from anon, authenticated;`,
    `revoke execute on all functions in schema ${schema} from public, anon, authenticated;`,
    `revoke all on schema ${schema} from public, anon, authenticated;`,
    `alter default privileges in schema ${schema} grant all on tables to service_role;`,
    `alter default privileges in schema ${schema} grant all on sequences to service_role;`,
    `alter default privileges in schema ${schema} grant execute on functions to service_role;`,
    ''
  ].join('\n');
}

// arquivos: [{ nome, conteudo }] na ordem de execução
function gerarSqlGrupo(arquivos, schema) {
  if (typeof schema !== 'string' || !/^[a-z][a-z0-9_]*$/.test(schema) || schema === 'public') {
    throw new Error('schema inválido: ' + JSON.stringify(schema) + ' (minúsculas, sem espaço, diferente de "public")');
  }
  const partes = [cabecalho(schema)];
  for (const { nome, conteudo } of arquivos) {
    partes.push(`-- ==== ${nome} (fonte: sql/${nome}) ====`);
    partes.push(trocarSchema(conteudo.replace(/\r\n/g, '\n'), schema).trimEnd());
    partes.push('');
  }
  partes.push(rodape(schema));
  return partes.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function executar() {
  const raiz = path.join(__dirname, '..');
  const arquivos = ARQUIVOS_DO_TERCA.map((nome) => ({ nome, conteudo: fs.readFileSync(path.join(raiz, 'sql', nome), 'utf8') }));
  const saida = path.join(raiz, 'sql', 'meme', 'schema-meme-supabase.sql');
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, gerarSqlGrupo(arquivos, 'meme'));
  console.log('Escrito sql/meme/schema-meme-supabase.sql (' + arquivos.length + ' arquivos do Terça, schema "meme").');
}

if (require.main === module) executar();
module.exports = { gerarSqlGrupo, trocarSchema, ARQUIVOS_DO_TERCA };
