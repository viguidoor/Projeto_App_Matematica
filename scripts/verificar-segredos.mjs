#!/usr/bin/env node
// Falha se encontrar chave secreta (JWT com role=service_role, chave privada) em arquivos versionados ou em dist/.
// Uso: node scripts/verificar-segredos.mjs   (rode `npm run build` antes para verificar também o build)
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean);
const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])) : []);
const targets = [...files, ...walk('dist')].filter((f) => !/\.(png|jpg|zip|ico)$/i.test(f) && existsSync(f));

const problems = [];
for (const f of targets) {
  const text = readFileSync(f, 'utf8');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) problems.push(`${f}: chave privada`);
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const role = JSON.parse(Buffer.from(m[1], 'base64url').toString()).role;
      if (role === 'service_role') problems.push(`${f}: JWT com role=service_role`);
    } catch {
      /* não é JWT */
    }
  }
  if (/\.env($|\.)/.test(f) && !/\.example$/.test(f)) problems.push(`${f}: arquivo .env versionado`);
}
if (problems.length) {
  console.error('SEGREDOS ENCONTRADOS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`ok: nenhum segredo em ${targets.length} arquivos (versionados + dist/).`);
