import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
// @ts-expect-error script .mjs sem tipos
import { migrate } from '../infra/local/migrate.mjs';
import { ENV, TEACHERS } from './env';

async function waitFor(url: string, headers: Record<string, string>, what: string) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(url, { headers });
      if (r.ok) return;
    } catch {
      /* ainda subindo */
    }
    if (Date.now() > deadline) {
      throw new Error(`A stack local não respondeu (${what}). Rode: npm run db:up`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export default async function setup() {
  await waitFor(`${ENV.url}/auth/v1/health`, { apikey: ENV.anonKey }, 'Auth');
  await waitFor(`${ENV.url}/rest/v1/`, { apikey: ENV.anonKey }, 'REST');

  // Banco limpo + migrações reais do projeto (as mesmas que irão para o Supabase hospedado).
  await migrate({ reset: true, quiet: true });

  const admin = createClient(ENV.url, ENV.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = new pg.Client({ host: ENV.dbHost, port: ENV.dbPort, user: 'postgres', password: ENV.dbPassword, database: 'postgres' });
  await db.connect();
  try {
    for (const [key, acc] of Object.entries(TEACHERS)) {
      const { data, error } = await admin.auth.admin.createUser({ email: acc.email, password: acc.password, email_confirm: true });
      if (error) throw new Error(`Não criou ${key}: ${error.message}`);
      if (key !== 'outsider') await db.query('insert into public.teachers (user_id) values ($1)', [data.user.id]);
    }
  } finally {
    await db.end();
  }
}
