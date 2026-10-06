import type { SupportedStorage } from '@supabase/supabase-js';
import pg from 'pg';
import { SupabaseRepository, type SupabaseRepositoryOptions } from '../src/data/supabase/supabaseRepository';
import { ENV, TEACHERS } from './env';

/** Armazenamento em memória: cada instância é um "navegador" com os seus próprios dados. */
export class MemoryAuthStorage implements SupportedStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const open: SupabaseRepository[] = [];

export function repoOptions(extra: Partial<SupabaseRepositoryOptions> = {}): SupabaseRepositoryOptions {
  return {
    url: ENV.url,
    anonKey: ENV.anonKey,
    studentStorage: new MemoryAuthStorage(),
    teacherStorage: new MemoryAuthStorage(),
    autoRefreshToken: false,
    pollMs: 400,
    retryBaseMs: 30,
    ...extra,
  };
}

export function makeRepo(extra: Partial<SupabaseRepositoryOptions> = {}): SupabaseRepository {
  const opts = repoOptions(extra);
  const repo = new SupabaseRepository(opts);
  (repo as unknown as { __opts: SupabaseRepositoryOptions }).__opts = opts;
  open.push(repo);
  return repo;
}

/** Um dispositivo de estudante novo (armazenamento próprio, sem login ainda). */
export function newDevice(extra: Partial<SupabaseRepositoryOptions> = {}): SupabaseRepository {
  return makeRepo(extra);
}

/** Atualizar a página: nova instância do repositório com o MESMO armazenamento (mesmo dispositivo). */
export function reloadDevice(old: SupabaseRepository, extra: Partial<SupabaseRepositoryOptions> = {}): SupabaseRepository {
  const opts = (old as unknown as { __opts: SupabaseRepositoryOptions }).__opts;
  return makeRepo({ ...opts, ...extra });
}

export async function loginTeacher(which: keyof typeof TEACHERS = 'a', extra: Partial<SupabaseRepositoryOptions> = {}) {
  const repo = makeRepo(extra);
  await repo.teacherAuth.signIn(TEACHERS[which].email, TEACHERS[which].password);
  return repo;
}

export async function disposeAll() {
  while (open.length) await open.pop()!.dispose();
}

export async function withDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ host: ENV.dbHost, port: ENV.dbPort, user: 'postgres', password: ENV.dbPassword, database: 'postgres' });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** Apaga os dados de sessões e os logins anônimos (mantém as contas de professor). Repete se o banco acusar deadlock. */
export async function resetData() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await withDb(async (db) => {
        await db.query('begin');
        try {
          // primeiro os dados que dependem dos usuários, depois os usuários (ordem fixa)
          await db.query('delete from public.sessions');
          await db.query('truncate public.join_attempts');
          await db.query('delete from auth.users where is_anonymous');
          await db.query('commit');
        } catch (e) {
          await db.query('rollback');
          throw e;
        }
      });
      return;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if ((code === '40P01' || code === '40001') && attempt < 5) {
        await new Promise((r) => setTimeout(r, 200 * attempt));
        continue;
      }
      throw e;
    }
  }
}
