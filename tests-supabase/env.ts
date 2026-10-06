import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, '..', 'infra', 'local', '.env'), 'utf8');
const vars = Object.fromEntries(raw.split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

/** Configuração da stack LOCAL (Docker). Nada aqui aponta para a nuvem. */
export const ENV = {
  url: process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321',
  anonKey: vars.ANON_KEY,
  serviceKey: vars.SERVICE_ROLE_KEY,
  dbPassword: vars.POSTGRES_PASSWORD,
  dbHost: '127.0.0.1',
  dbPort: 54322,
  /** Limite de logins anônimos por hora por IP configurado no Auth local (padrão do Supabase: 30). */
  anonRateLimit: Number(vars.ANON_RATE_LIMIT ?? 30),
};

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(ENV.url)) {
  throw new Error('Os testes só rodam contra a stack LOCAL (127.0.0.1).');
}

/** Contas de professor DESCARTÁVEIS, criadas só no banco local pelos testes. */
export const TEACHERS = {
  a: { email: 'professor.a@teste.local', password: 'senha-local-A1!' },
  b: { email: 'professor.b@teste.local', password: 'senha-local-B1!' },
  // Conta com e-mail e senha que NÃO está na lista de professores (ex.: alguém que se cadastrou sozinho).
  outsider: { email: 'curioso@teste.local', password: 'senha-local-C1!' },
};
