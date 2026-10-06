import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RepositoryError } from '../src/data/repository';
import type { SupabaseRepository } from '../src/data/supabase/supabaseRepository';
import { ENV } from './env';
import { disposeAll, loginTeacher, newDevice, resetData, withDb } from './world';

/**
 * 35 estudantes/equipes entrando na MESMA sessão pela MESMA rede (um único IP: todas as chamadas saem do mesmo
 * computador e passam pelo mesmo gateway). Cada "dispositivo" tem login anônimo e armazenamento próprios.
 *
 * O Auth limita logins anônimos por hora por IP (padrão do Supabase: 30; configurável). O teste se adapta ao limite
 * configurado na stack local (infra/local/.env → ANON_RATE_LIMIT) e DOCUMENTA o que acontece nos dois casos:
 *   - limite >= 35: todas entram e o sistema aguenta 35 equipes trabalhando ao mesmo tempo;
 *   - limite  < 35: as equipes além do limite recebem RATE_LIMITED (mensagem clara) e as demais seguem normalmente.
 */
const N = 35;
const LIMIT = ENV.anonRateLimit;
const sub = (a: string) => ({ calculation: '8 x 5 : 2', rawAnswer: a, unit: 'm²' as const, justification: 'Metade do produto das diagonais.' });

let teacher: SupabaseRepository;
let sessionCode: string;
const devices: SupabaseRepository[] = [];
const outcomes: Array<{ ok: true; teamId: string } | { ok: false; code: string; message: string }> = [];

beforeAll(async () => {
  await resetData();
  teacher = await loginTeacher('a');
  sessionCode = (await teacher.openSession()).code;
});
afterAll(disposeAll);

describe(`${N} equipes pela mesma rede (limite de logins anônimos por hora e por IP no Auth local: ${LIMIT})`, () => {
  it(`${N} dispositivos tentam entrar ao mesmo tempo`, async () => {
    const t0 = Date.now();
    const settled = await Promise.allSettled(
      Array.from({ length: N }, (_, i) => {
        const d = newDevice();
        devices.push(d);
        return d.joinSession(sessionCode, `Equipe ${String(i + 1).padStart(2, '0')}`);
      }),
    );
    const elapsed = Date.now() - t0;
    settled.forEach((r) => {
      if (r.status === 'fulfilled') outcomes.push({ ok: true, teamId: r.value.id });
      else {
        const e = r.reason as RepositoryError;
        outcomes.push({ ok: false, code: e.code ?? 'ERRO', message: e.message });
      }
    });
    const ok = outcomes.filter((o) => o.ok).length;
    const failed = outcomes.filter((o): o is Extract<typeof o, { ok: false }> => !o.ok);
    console.log(`[35 entradas] limite=${LIMIT}/h/IP → entraram ${ok} de ${N} em ${elapsed} ms; recusadas: ${failed.length}${failed.length ? ` (códigos: ${[...new Set(failed.map((f) => f.code))].join(', ')})` : ''}`);

    if (LIMIT >= N) {
      expect(ok).toBe(N);
      expect(failed).toEqual([]);
    } else {
      // Limitação do Auth: nunca entram mais do que o limite, e quem sobra recebe uma mensagem clara.
      expect(ok).toBeLessThanOrEqual(LIMIT);
      expect(ok).toBeGreaterThan(0);
      expect(failed.length).toBe(N - ok);
      for (const f of failed) {
        expect(f.code).toBe('RATE_LIMITED');
        expect(f.message).toMatch(/mesma rede/);
      }
    }
  });

  it('cada equipe que entrou tem identificador próprio e o professor vê exatamente essas equipes', async () => {
    const ids = outcomes.filter((o): o is Extract<typeof o, { ok: true }> => o.ok).map((o) => o.teamId);
    expect(new Set(ids).size).toBe(ids.length);
    const seen = await teacher.listTeams(sessionCode);
    expect(seen.map((t) => t.id).sort()).toEqual([...ids].sort());
    expect(new Set(seen.map((t) => t.alias)).size).toBe(ids.length);
  });

  it('nenhuma equipe lê dados de outra, mesmo com 35 ao mesmo tempo', async () => {
    const joined = outcomes.map((o, i) => (o.ok ? { i, teamId: o.teamId } : null)).filter((x): x is { i: number; teamId: string } => x !== null);
    await Promise.all(
      joined.map(async ({ i, teamId }, k) => {
        const mine = await devices[i].getTeam(teamId);
        expect(mine?.id).toBe(teamId);
        const other = joined[(k + 1) % joined.length];
        if (other.teamId !== teamId) expect(await devices[i].getTeam(other.teamId)).toBeNull();
      }),
    );
  });

  it('todas as equipes que entraram enviam diagnóstico, hipótese inicial e saída ao mesmo tempo, sem perder nem duplicar nada', async () => {
    const joined = outcomes.map((o, i) => (o.ok ? { i, teamId: o.teamId } : null)).filter((x): x is { i: number; teamId: string } => x !== null);
    const n = joined.length;
    const t0 = Date.now();
    await Promise.all(joined.map(({ i, teamId }, k) => devices[i].submitDiagnostic(teamId, sub(k % 2 ? '40' : '20'))));
    await Promise.all(joined.map(({ i, teamId }) => devices[i].saveProgress(teamId, { phase: 'hipotese' })));
    await Promise.all(joined.map(({ i, teamId }, k) => devices[i].submitHypothesis(teamId, sub(k % 3 ? '60' : '30'))));
    await Promise.all(joined.map(({ i, teamId }) => devices[i].saveProgress(teamId, { phase: 'saida' })));
    await Promise.all(joined.map(({ i, teamId }) => devices[i].submitExit(teamId, { ...sub('24'), calculation: '12 x 4 : 2' })));
    const elapsed = Date.now() - t0;
    console.log(`[35 entradas] ${n} equipes × 5 envios simultâneos em ${elapsed} ms`);

    const rows = await withDb(async (db) => (await db.query(`select kind, count(*)::int as n, count(distinct team_id)::int as teams from public.submissions group by kind order by kind`)).rows);
    expect(rows).toEqual([
      { kind: 'diagnostico', n, teams: n },
      { kind: 'hipotese', n, teams: n },
      { kind: 'saida', n, teams: n },
    ]);
    const seen = await teacher.listTeams(sessionCode);
    expect(seen.every((t) => t.phase === 'concluido' && t.diagnostic && t.hypothesis && t.exit)).toBe(true);
  });

  it('a projeção agrega as respostas de todas as equipes, sem apelidos', async () => {
    await teacher.setProjection({ kind: 'distribution', stage: 'diagnostico', showCorrect: false });
    const view = await teacher.getProjectionView(sessionCode);
    const n = outcomes.filter((o) => o.ok).length;
    expect(view.kind === 'distribution' && view.distribution.total).toBe(n);
    expect(view.kind === 'distribution' && view.distribution.suppressed).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/Equipe \d\d/);
  });

  it('encerrar a sessão bloqueia todas as equipes de uma vez', async () => {
    await teacher.closeSession(sessionCode);
    const joined = outcomes.map((o, i) => (o.ok ? { i, teamId: o.teamId } : null)).filter((x): x is { i: number; teamId: string } => x !== null);
    const codes = await Promise.all(
      joined.map(({ i, teamId }) => devices[i].saveProgress(teamId, { phase: 'exploracao' }).then(() => 'OK', (e: RepositoryError) => e.code)),
    );
    expect(new Set(codes)).toEqual(new Set(['SESSION_CLOSED']));
  });
});
