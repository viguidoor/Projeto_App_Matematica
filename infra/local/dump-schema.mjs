#!/usr/bin/env node
// Gera docs/ETAPA2A_ESQUEMA.md a partir do banco LOCAL já migrado (tabelas, restrições, políticas, funções e permissões).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(readFileSync(join(here, '.env'), 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const db = new pg.Client({ host: '127.0.0.1', port: 54322, user: 'postgres', password: env.POSTGRES_PASSWORD, database: 'postgres' });
await db.connect();
const q = async (sql) => (await db.query(sql)).rows;

const tables = await q(`select c.relname as t, c.relrowsecurity as rls, obj_description(c.oid) as doc from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1`);
const cols = await q(`select table_name t, column_name c, data_type ty, is_nullable n, column_default d from information_schema.columns where table_schema='public' order by table_name, ordinal_position`);
const cons = await q(`select conrelid::regclass::text t, conname n, contype ty, pg_get_constraintdef(oid) d from pg_constraint where connamespace='public'::regnamespace and contype in ('c','u','f','p') order by 1, 3, 2`);
const idx = await q(`select tablename t, indexname n, indexdef d from pg_indexes where schemaname='public' and indexname not like '%_pkey' and indexname not in (select conname from pg_constraint where contype='u') order by 1,2`);
const pols = await q(`select tablename t, policyname n, cmd, roles::text r, qual from pg_policies where schemaname='public' order by 1,2`);
const views = await q(`select viewname v from pg_views where schemaname='public' order by 1`);
const fns = await q(`select n.nspname s, p.proname f, pg_get_function_identity_arguments(p.oid) a, p.prosecdef sd, has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth, has_function_privilege('service_role', p.oid, 'EXECUTE') svc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f' order by 1,2`);
const pub = await q(`select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' order by 1`);
await db.end();

const out = [];
out.push('# Operação Área — esquema final do banco (Etapa 2a)\n');
out.push('> Gerado por `node infra/local/dump-schema.mjs` a partir do banco local migrado com `supabase/migrations/*.sql`. **Não editar à mão.**\n');
out.push('Percurso registrado em `submissions.kind`: **diagnostico → hipotese → tentativa (0..n, revisões) → saida**.\n');
out.push('## Tabelas\n');
for (const t of tables) {
  out.push(`### public.${t.t}  ${t.rls ? '(RLS ligada)' : '(**sem RLS**)'}\n`);
  out.push('| Coluna | Tipo | Nulo? | Padrão |\n|---|---|---|---|');
  for (const c of cols.filter((x) => x.t === t.t)) out.push(`| \`${c.c}\` | ${c.ty} | ${c.n === 'YES' ? 'sim' : 'não'} | ${c.d ? '`' + c.d.replace(/\|/g, '\\|') + '`' : ''} |`);
  const cs = cons.filter((x) => x.t === t.t);
  if (cs.length) {
    out.push('\nRestrições:\n');
    for (const c of cs) out.push(`- \`${c.n}\` (${{ c: 'check', u: 'único', f: 'chave estrangeira', p: 'chave primária' }[c.ty]}): \`${c.d}\``);
  }
  const ix = idx.filter((x) => x.t === t.t);
  if (ix.length) {
    out.push('\nÍndices:\n');
    for (const i of ix) out.push(`- \`${i.d}\``);
  }
  out.push('');
}
out.push('## Visões de análise (security_invoker: valem as regras de quem consulta)\n');
for (const v of views) out.push(`- \`public.${v.v}\``);
out.push('\n## Políticas de acesso (RLS)\n');
out.push('| Tabela | Política | Operação | Papéis | Condição |\n|---|---|---|---|---|');
for (const p of pols) out.push(`| ${p.t} | ${p.n} | ${p.cmd} | ${p.r} | \`${(p.qual ?? '').replace(/\|/g, '\\|')}\` |`);
out.push('\nTabelas com RLS e **sem** política (acesso negado a todos os papéis de API): ' + tables.filter((t) => !pols.some((p) => p.t === t.t)).map((t) => `\`${t.t}\``).join(', ') + '.\n');
out.push('## Funções e quem pode executá-las\n');
out.push('`DEFINER` = roda com os privilégios do dono e valida quem chamou por dentro (`auth.uid()`, `is_teacher()`).\n');
out.push('| Função | Schema | Definer | anon | authenticated | service_role |\n|---|---|---|---|---|---|');
for (const f of fns) out.push(`| \`${f.f}(${f.a})\` | ${f.s} | ${f.sd ? 'sim' : 'não'} | ${f.anon ? '✔' : '—'} | ${f.auth ? '✔' : '—'} | ${f.svc ? '✔' : '—'} |`);
out.push('\n## Tempo real\n');
out.push('Tabelas na publicação `supabase_realtime` (o Realtime aplica a RLS de cada assinante): ' + pub.map((p) => `\`${p.tablename}\``).join(', ') + '.\n');
writeFileSync(join(here, '..', '..', 'docs', 'ETAPA2A_ESQUEMA.md'), out.join('\n'));
console.log('docs/ETAPA2A_ESQUEMA.md gerado');
