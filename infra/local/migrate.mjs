#!/usr/bin/env node
// Aplica supabase/migrations/*.sql no banco LOCAL (Docker). Uso: node infra/local/migrate.mjs [--reset]
// --reset apaga os objetos da aplicação (schemas public/app_private) e os usuários do Auth LOCAL antes de aplicar.
// Recusa rodar contra qualquer host que não seja 127.0.0.1/localhost.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '.env'), 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const host = process.env.DB_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost'].includes(host)) {
  console.error('Recusado: este script só roda contra o banco local.');
  process.exit(1);
}

export async function migrate({ reset = false, quiet = false } = {}) {
  const client = new pg.Client({ host, port: Number(process.env.DB_PORT || 54322), user: 'postgres', password: env.POSTGRES_PASSWORD, database: 'postgres' });
  await client.connect();
  try {
    if (reset) {
      await client.query(`
        do $$
        declare r record;
        begin
          for r in select viewname from pg_views where schemaname = 'public' loop execute format('drop view if exists public.%I cascade', r.viewname); end loop;
          for r in select tablename from pg_tables where schemaname = 'public' loop execute format('drop table if exists public.%I cascade', r.tablename); end loop;
          for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
          loop execute format('drop function if exists %s cascade', r.fn); end loop;
        end $$;
        drop schema if exists app_private cascade;
        delete from auth.users;
      `);
    }
    const dir = join(here, '..', '..', 'supabase', 'migrations');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      await client.query(readFileSync(join(dir, f), 'utf8'));
      if (!quiet) console.log('aplicada', f);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate({ reset: process.argv.includes('--reset') }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
