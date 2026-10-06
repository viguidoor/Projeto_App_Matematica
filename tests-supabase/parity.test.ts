import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAggregateExport } from '../src/domain/aggregate';
import { formatNumber } from '../src/domain/area';
import type { SupabaseRepository } from '../src/data/supabase/supabaseRepository';
import vectors from '../tests/vectors/evaluate.json';
import { ENV } from './env';
import { disposeAll, loginTeacher, newDevice, resetData, withDb } from './world';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sub = (answer: string, extra: Record<string, unknown> = {}) => ({
  calculation: '10 x 6 : 2',
  rawAnswer: answer,
  unit: 'm²' as const,
  justification: 'Metade do retângulo que envolve o losango.',
  ...extra,
});

let teacher: SupabaseRepository;
afterAll(disposeAll);
beforeAll(async () => {
  await resetData();
  teacher = await loginTeacher('a');
});

describe('vetores compartilhados: o SQL dá o mesmo resultado que o TypeScript', () => {
  it('evaluate (acerto e padrão de erro) em todos os casos', async () => {
    await withDb(async (db) => {
      for (const v of vectors.evaluate) {
        const { rows } = await db.query('select correct, pattern from app_private.evaluate($1::numeric, $2::numeric, $3::numeric, $4)', [v.major, v.minor, v.answer, v.unit]);
        expect({ correct: rows[0].correct, pattern: rows[0].pattern }, `${v.major}×${v.minor} → ${v.answer} ${v.unit}`).toEqual({ correct: v.correct, pattern: v.pattern });
      }
    });
  });

  it('formatNumber: texto idêntico ao do aplicativo (vírgula decimal e ponto de milhar)', async () => {
    await withDb(async (db) => {
      for (const v of vectors.formatNumber) {
        const { rows } = await db.query('select app_private.format_number($1::numeric) as t', [v.value]);
        expect(rows[0].t, String(v.value)).toBe(v.text);
        expect(formatNumber(v.value)).toBe(v.text);
      }
    });
  });

  it('dados pessoais em texto livre: mesmas decisões do aplicativo', async () => {
    await withDb(async (db) => {
      for (const v of vectors.dadosPessoais) {
        const { rows } = await db.query('select app_private.contains_personal_data($1) as p', [v.text]);
        expect(rows[0].p, v.text).toBe(v.pessoal);
      }
    });
  });

  it('as medidas fixas do diagnóstico e da saída no banco são as da missão (8 × 5 e 12 × 4)', async () => {
    await withDb(async (db) => {
      const d = (await db.query(`select major, minor from app_private.problem_measures('diagnostico')`)).rows[0];
      const x = (await db.query(`select major, minor from app_private.problem_measures('saida')`)).rows[0];
      expect([Number(d.major), Number(d.minor)]).toEqual([8, 5]);
      expect([Number(x.major), Number(x.minor)]).toEqual([12, 4]);
    });
  });
});

describe('exportação pedagógica anônima: o SQL e o aplicativo geram os mesmos dados', () => {
  it('linhas e resumo idênticos, sem apelidos, textos livres, horários nem identificadores', async () => {
    const s = await teacher.openSession();
    const script: Array<{ alias: string; diag: string; hyp?: string; hints?: number; revisions?: string[]; exit?: string }> = [
      { alias: 'Equipe Alfa', diag: '20', hyp: '30', exit: '24' },
      { alias: 'Equipe Beta', diag: '40', hyp: '60', hints: 2, revisions: ['16', '30'], exit: '24' },
      { alias: 'Equipe Gama', diag: '40', hyp: '60', hints: 1, revisions: ['30'], exit: '48' },
      { alias: 'Equipe Delta', diag: '13' },
      { alias: 'Equipe Épsilon', diag: '20', hyp: '8', exit: '8' },
      { alias: 'Equipe Zeta', diag: '20', hyp: '30' },
    ];
    for (const e of script) {
      const d = newDevice();
      const team = await d.joinSession(s.code, e.alias);
      await d.submitDiagnostic(team.id, sub(e.diag, { calculation: '8 x 5 : 2' }));
      if (!e.hyp) continue;
      await d.saveProgress(team.id, { phase: 'hipotese' });
      await d.submitHypothesis(team.id, sub(e.hyp));
      for (let l = 1; l <= (e.hints ?? 0); l += 1) await d.recordHint(team.id, l as 1 | 2); // só depois da hipótese inicial
      for (const r of e.revisions ?? []) {
        await d.saveProgress(team.id, { phase: 'exploracao' });
        await d.saveProgress(team.id, { phase: 'hipotese' });
        await d.submitAttempt(team.id, sub(r));
      }
      if (e.exit) {
        await d.saveProgress(team.id, { phase: 'saida' });
        await d.submitExit(team.id, sub(e.exit, { calculation: '12 x 4 : 2' }));
      }
    }

    const teams = await teacher.listTeams(s.code);
    const local = buildAggregateExport(teams, 'CONECTADO');
    const client = createClient(ENV.url, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await client.auth.signInWithPassword({ email: 'professor.a@teste.local', password: 'senha-local-A1!' });
    const { data, error } = await client.rpc('export_anonymous', { p_code: s.code });
    expect(error).toBeNull();
    const server = data as { linhas: unknown[]; resumo: unknown };

    expect(server.resumo).toEqual(local.resumo);
    expect(server.linhas).toEqual(local.linhas);

    // anonimato: nada que identifique equipes ou estudantes
    const text = JSON.stringify(data);
    for (const t of teams) {
      expect(text).not.toContain(t.alias);
      expect(text).not.toContain(t.id);
    }
    expect(text).not.toMatch(/Metade do retângulo|justif|calcul|submittedAt|joinedAt|created_at|user_id|alias/i);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // sem datas e horários
    expect(local.resumo.trajetorias['diag=errado;hip=errado;rev=2;saida=certo']).toBe(1);
  });

  it('outro professor recebe vazio e estudantes são recusados', async () => {
    const s = (await teacher.getCurrentSession())!;
    const b = createClient(ENV.url, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await b.auth.signInWithPassword({ email: 'professor.b@teste.local', password: 'senha-local-B1!' });
    const other = await b.rpc('export_anonymous', { p_code: s.code });
    expect(other.data).toEqual({ linhas: [], resumo: null });
    const stu = createClient(ENV.url, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await stu.auth.signInAnonymously();
    expect((await stu.rpc('export_anonymous', { p_code: s.code })).error?.hint).toBe('NOT_AUTHORIZED');
  });
});

describe('retenção de 30 dias dos dados brutos', () => {
  it('a sessão devolve a data de exclusão (30 dias) para o painel avisar o professor', async () => {
    const s = await teacher.openSession();
    expect(s.retentionUntil! - s.openedAt).toBeGreaterThan(29.99 * 86_400_000);
    expect(s.retentionUntil! - s.openedAt).toBeLessThan(30.01 * 86_400_000);
  });

  it('a sessão nasce com retenção de 30 dias', async () => {
    const s = await teacher.openSession();
    const row = await withDb(async (db) =>
      (await db.query(`select extract(epoch from (retention_until - created_at)) / 86400 as dias from public.sessions where code = $1 order by created_at desc limit 1`, [s.code])).rows[0],
    );
    expect(Number(row.dias)).toBeCloseTo(30, 2);
  });

  it('a rotina apaga só o que venceu (e tudo o que depende disso) e preserva as sessões dentro do prazo', async () => {
    await resetData();
    const old = await teacher.openSession();
    const dOld = newDevice();
    const tOld = await dOld.joinSession(old.code, 'Equipe Antiga');
    await dOld.submitDiagnostic(tOld.id, sub('20', { calculation: '8 x 5 : 2' }));
    await teacher.addNote(old.code, { team: null, difficulty: 'antiga', intervention: '', response: '' });
    const fresh = await teacher.openSession();
    const dNew = newDevice();
    const tNew = await dNew.joinSession(fresh.code, 'Equipe Nova');

    await withDb(async (db) => {
      await db.query(`update public.sessions set retention_until = now() - interval '1 minute' where code = $1`, [old.code]);
      await db.query(`insert into public.join_attempts (user_id, tried_code, ok, at) values ($1, 'VELHO', false, now() - interval '2 days')`, [tOld.id]);
    });

    // só a chave de serviço pode executar a rotina
    const admin = createClient(ENV.url, ENV.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.rpc('purge_expired_data');
    expect(error).toBeNull();
    expect(data).toMatchObject({ sessoes_apagadas: 1, tentativas_de_entrada_apagadas: 1 });

    const left = await withDb(async (db) => ({
      sessions: (await db.query('select code from public.sessions')).rows.map((r) => r.code),
      teams: (await db.query('select id from public.teams')).rows.map((r) => r.id),
      submissions: (await db.query('select count(*)::int as n from public.submissions')).rows[0].n,
      interventions: (await db.query('select count(*)::int as n from public.interventions')).rows[0].n,
      events: (await db.query('select count(*)::int as n from public.team_events')).rows[0].n,
    }));
    expect(left.sessions).toEqual([fresh.code]);
    expect(left.teams).toEqual([tNew.id]);
    expect(left.submissions).toBe(0);
    expect(left.interventions).toBe(0);
    expect(left.events).toBe(1); // só o "entrou" da equipe nova
    expect(await dOld.getTeam(tOld.id)).toBeNull();
  });

  it('logins anônimos com mais de 30 dias também são apagados (ou a ausência de permissão fica registrada)', async () => {
    const { client, userId } = await (async () => {
      const c = createClient(ENV.url, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data } = await c.auth.signInAnonymously();
      return { client: c, userId: data.user!.id };
    })();
    void client;
    await withDb((db) => db.query(`update auth.users set created_at = now() - interval '31 days' where id = $1`, [userId]));
    const admin = createClient(ENV.url, ENV.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await admin.rpc('purge_expired_data');
    const apagados = (data as { logins_anonimos_apagados: number }).logins_anonimos_apagados;
    const still = await withDb(async (db) => (await db.query('select count(*)::int as n from auth.users where id = $1', [userId])).rows[0].n);
    if (apagados >= 1) expect(still).toBe(0);
    else expect(apagados).toBe(-1); // sem permissão no schema auth: precisa ser tratado no ambiente hospedado (ver relatório)
  });
});

describe('visões de análise e linha do tempo (tempo aproximado)', () => {
  it('v_trajetoria mostra a trajetória e o tempo APROXIMADO por etapa, só para o professor', async () => {
    await resetData();
    const s = await teacher.openSession();
    const d = newDevice();
    const team = await d.joinSession(s.code, 'Equipe Tempo');
    await sleep(1_100);
    await d.submitDiagnostic(team.id, sub('20', { calculation: '8 x 5 : 2' }));
    await sleep(600);
    await d.saveProgress(team.id, { phase: 'hipotese' });
    await d.submitHypothesis(team.id, sub('60'));
    await d.recordHint(team.id, 1);
    await d.saveProgress(team.id, { phase: 'exploracao' });
    await d.saveProgress(team.id, { phase: 'hipotese' });
    await d.submitAttempt(team.id, sub('30'));
    await d.saveProgress(team.id, { phase: 'saida' });
    await d.submitExit(team.id, sub('24', { calculation: '12 x 4 : 2' }));

    const t = createClient(ENV.url, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await t.auth.signInWithPassword({ email: 'professor.a@teste.local', password: 'senha-local-A1!' });
    const { data, error } = await t.from('v_trajetoria').select('*');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      alias: 'Equipe Tempo',
      diagnostico_correto: true,
      hipotese_correta: false,
      hipotese_padrao: 'produto_sem_metade',
      hipotese_dica: 0, // a hipótese inicial é sempre sem dicas
      revisoes: 1,
      acertou_em_revisao: true,
      dica_maxima: 1,
      saida_correta: true,
    });
    expect(data![0].diagnostico_ms).toBeGreaterThanOrEqual(1_000); // esperou ~1,1 s antes de enviar
    expect(data![0].tempo_aproximado_s).toBeGreaterThanOrEqual(1);

    const events = await withDb(async (db) => (await db.query(`select type from public.team_events where team_id = $1 order by created_at, type`, [team.id])).rows.map((r) => r.type));
    expect(events).toEqual(expect.arrayContaining(['entrou', 'enviou_diagnostico', 'iniciou_exploracao', 'abriu_dica', 'enviou_hipotese', 'enviou_tentativa', 'foi_para_saida', 'enviou_saida']));

    // estudantes não enxergam as visões
    const stu = createClient(ENV.url, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await stu.auth.signInAnonymously();
    expect((await stu.from('v_trajetoria').select('*')).data ?? []).toEqual([]);
  });

  it('v_apos_intervencao liga cada intervenção ao primeiro registro da equipe DEPOIS dela (nova evidência)', async () => {
    await resetData();
    const s = await teacher.openSession();
    const d = newDevice();
    const team = await d.joinSession(s.code, 'Equipe Mediada');
    await d.submitDiagnostic(team.id, sub('40', { calculation: '8 x 5' }));
    await d.saveProgress(team.id, { phase: 'hipotese' });
    await d.submitHypothesis(team.id, sub('60'));
    await sleep(300);
    await teacher.addNote(s.code, { team: 'Equipe Mediada', difficulty: 'esqueceu a divisão por 2', intervention: 'como o losango se relaciona ao retângulo?', response: 'vão refazer' });
    await sleep(300);
    await d.saveProgress(team.id, { phase: 'exploracao' });
    await d.saveProgress(team.id, { phase: 'hipotese' });
    await d.submitAttempt(team.id, sub('30'));

    const t = createClient(ENV.url, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await t.auth.signInWithPassword({ email: 'professor.a@teste.local', password: 'senha-local-A1!' });
    const { data } = await t.from('v_apos_intervencao').select('*');
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      team_alias: 'Equipe Mediada',
      dificuldade_observada: 'esqueceu a divisão por 2',
      registro_seguinte: 'tentativa',
      registro_seguinte_n: 1,
      registro_seguinte_correto: true,
    });
    expect(data![0].segundos_ate_o_registro).toBeGreaterThanOrEqual(0);
  });
});

describe('expiração do código', () => {
  it('depois de expirar, o código não aceita novas equipes (as que já entraram seguem trabalhando)', async () => {
    await resetData();
    const s = await teacher.openSession();
    const early = newDevice();
    const team = await early.joinSession(s.code, 'Equipe Cedo');
    await withDb((db) => db.query(`update public.sessions set created_at = now() - interval '3 hours', expires_at = now() - interval '1 minute' where code = $1`, [s.code]));
    await expect(newDevice().joinSession(s.code, 'Equipe Tarde')).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
    const still = await early.submitDiagnostic(team.id, sub('20', { calculation: '8 x 5 : 2' }));
    expect(still.answer).toBe(20);
  });
});
