#!/usr/bin/env node
// Gera infra/local/.env com segredos ALEATÓRIOS (uso local apenas; o arquivo é ignorado pelo git).
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '.env');
if (existsSync(out) && !process.argv.includes('--force')) {
  console.log('infra/local/.env já existe (use --force para recriar).');
  process.exit(0);
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (payload, secret) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64(payload);
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};
const jwtSecret = randomBytes(32).toString('hex');
const now = Math.floor(Date.now() / 1000);
const tenYears = now + 10 * 365 * 24 * 3600;
const env = {
  POSTGRES_PASSWORD: randomBytes(16).toString('hex'),
  JWT_SECRET: jwtSecret,
  JWT_EXP: '3600',
  ANON_KEY: sign({ role: 'anon', iss: 'operacao-area-local', iat: now, exp: tenYears }, jwtSecret),
  SERVICE_ROLE_KEY: sign({ role: 'service_role', iss: 'operacao-area-local', iat: now, exp: tenYears }, jwtSecret),
  SECRET_KEY_BASE: randomBytes(48).toString('hex'),
  // Limite do Auth para logins anônimos por hora por IP (padrão do Supabase: 30). Veja docs/ETAPA2A_RELATORIO.md.
  ANON_RATE_LIMIT: '30',
};
writeFileSync(out, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
console.log('infra/local/.env criado.');
