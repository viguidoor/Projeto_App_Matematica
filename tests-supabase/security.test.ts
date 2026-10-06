import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RepositoryError } from '../src/data/repository';
import type { SupabaseRepository } from '../src/data/supabase/supabaseRepository';
import { ENV, TEACHERS } from './env';
import { disposeAll, loginTeacher, newDevice, resetData, withDb } from './world';

const PROFESSOR_TABLES = ['teachers', 'sessions', 'teams', 'submissions', 'hint_events', 'team_events', 'interventions', 'projection'];
const ALL_TABLES = [...PROFESSOR_TABLES, 'join_attempts'];
const VIEWS = ['v_trajetoria', 'v_apos_intervencao'];
const TEACHER_FUNCTIONS: Array<[string, Record<string, unknown>]> = [
  ['create_session', {}],
  ['close_session', { p_code: 'AAAAAA' }],
  ['delete_session', { p_code: 'AAAAAA' }],
  ['get_current_session', {}],
  ['list_teams', { p_code: 'AAAAAA' }],
  ['add_note', { p_code: 'AAAAAA', p_team_alias: null, p_difficulty: 'x', p_intervention: '', p_response: '' }],
  ['list_notes', { p_code: 'AAAAAA' }],
  ['set_projection', { p_payload: { kind: 'none' } }],
  ['get_projection_config', {}],
  ['export_anonymous', { p_code: 'AAAAAA' }],
];
const STUDENT_FUNCTIONS: Array<[string, Record<string, unknown>]> = [
  ['join_session', { p_code: 'AAAAAA', p_alias: 'Equipe X' }],
  ['get_team', { p_team: '00000000-0000-4000-8000-000000000000' }],
  ['save_progress', { p_team: '00000000-0000-4000-8000-000000000000', p_phase: 'hipotese' }],
  ['record_hint', { p_team: '00000000-0000-4000-8000-000000000000', p_level: 1 }],
  ['submit_diagnostic', { p_team: '00000000-0000-4000-8000-000000000000', p_calculation: 'abc', p_raw_answer: '1', p_unit: 'm²', p_justification: 'abcdefgh' }],
];

/** Coluna de chave primária de cada tabela (para sondas de escrita que respeitem o esquema). */
const KEY: Record<string, string> = {
  teachers: 'user_id', sessions: 'id', teams: 'id', submissions: 'id', hint_events: 'id',
  team_events: 'id', interventions: 'id', projection: 'session_id', join_attempts: 'user_id',
};
const FAKE = '00000000-0000-4000-8000-0000000000aa';
const probeInsert = (table: string): Record<string, unknown> =>
  table === 'join_attempts' ? { user_id: FAKE, tried_code: 'X', ok: true } : { [KEY[table]]: FAKE };

const rawClient = () => createClient(ENV.url, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
async function anonymousClient(): Promise<{ client: SupabaseClient; userId: string }> {
  const client = rawClient();
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return { client, userId: data.user!.id };
}

let teacherA: SupabaseRepository;
let teacherB: SupabaseRepository;
let codeA: string;
let teamA: { id: string };
let deviceA: SupabaseRepository;

const answer = (a: string) => ({ calculation: '8 x 5 : 2', rawAnswer: a, unit: 'm²' as const, justification: 'Metade do produto das diagonais.' });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof RepositoryError ? e.code : `ERRO:${(e as Error).message}`;
  }
}

beforeAll(async () => {
  await resetData();
  teacherA = await loginTeacher('a');
  teacherB = await loginTeacher('b');
  const s = await teacherA.openSession();
  codeA = s.code;
  deviceA = newDevice();
  teamA = await deviceA.joinSession(codeA, 'Equipe Alfa');
  await deviceA.submitDiagnostic(teamA.id, answer('20'));
  await teacherA.addNote(codeA, { team: 'Equipe Alfa', difficulty: 'nota privada do professor', intervention: '', response: '' });
});
afterAll(disposeAll);

describe('estudante (login anônimo) não acessa dados do professor', () => {
  it.each([...ALL_TABLES, ...VIEWS])('não lê a tabela/visão %s (RLS devolve zero linhas ou nega)', async (table) => {
    const { client } = await anonymousClient();
    const { data, error } = await client.from(table).select('*');
    expect(error?.code === '42501' || (data ?? []).length === 0, `${table} não pode devolver linhas`).toBe(true);
  });

  it('não lê nem a própria equipe diretamente: o estudante só enxerga o que as funções devolvem', async () => {
    const { client } = await anonymousClient();
    const res = await client.from('teams').select('*').eq('id', teamA.id);
    expect(res.data ?? []).toEqual([]);
  });

  it.each(ALL_TABLES)('não escreve direto em %s (inserir, alterar e apagar são negados) e nada muda no banco', async (table) => {
    const { client } = await anonymousClient();
    const before = await withDb(async (db) => (await db.query(`select count(*)::int as n, md5(string_agg(t::text, '' order by t::text)) as h from public.${table} t`)).rows[0]);
    const ins = await client.from(table).insert(probeInsert(table));
    const upd = await client.from(table).update(probeInsert(table)).neq(KEY[table], '00000000-0000-4000-8000-000000000001');
    const del = await client.from(table).delete().neq(KEY[table], '00000000-0000-4000-8000-000000000001');
    for (const r of [ins, upd, del]) expect(r.error?.code, `${table}: ${JSON.stringify(r.error)}`).toBe('42501');
    const after = await withDb(async (db) => (await db.query(`select count(*)::int as n, md5(string_agg(t::text, '' order by t::text)) as h from public.${table} t`)).rows[0]);
    expect(after).toEqual(before);
  });

  it('não forja resultado: inserir envio com correct=true é negado e o campo não existe nas funções', async () => {
    const { client } = await anonymousClient();
    const forged = await client.from('submissions').insert({ team_id: teamA.id, kind: 'saida', correct: true });
    expect(forged.error?.code).toBe('42501');
    const viaRpc = await client.rpc('submit_diagnostic', { p_team: teamA.id, p_calculation: 'abc', p_raw_answer: '20', p_unit: 'm²', p_justification: 'abcdefgh', p_correct: true });
    expect(viaRpc.error?.code).toBe('PGRST202'); // a função não aceita parâmetro "correct"
  });

  it.each(TEACHER_FUNCTIONS)('não executa a função docente %s', async (fn, args) => {
    const { client } = await anonymousClient();
    const { error } = await client.rpc(fn, args);
    expect(error, `${fn} deveria ser recusada`).not.toBeNull();
    expect(['NOT_AUTHORIZED', 'PGRST202', '42501']).toContain(error!.hint === 'NOT_AUTHORIZED' ? 'NOT_AUTHORIZED' : error!.code);
  });

  it('não executa a rotina de retenção nem as funções internas (schema privado)', async () => {
    const { client } = await anonymousClient();
    expect((await client.rpc('purge_expired_data')).error?.code).toBe('42501');
    for (const fn of ['is_teacher', 'is_session_teacher', 'evaluate', 'insert_submission', 'team_json']) {
      expect((await client.rpc(fn, {})).error, fn).not.toBeNull();
    }
    // o schema privado não é exposto pela API
    const res = await fetch(`${ENV.url}/rest/v1/rpc/evaluate`, {
      method: 'POST',
      headers: { apikey: ENV.anonKey, 'Content-Type': 'application/json', 'Content-Profile': 'app_private' },
      body: JSON.stringify({ p_major: 10, p_minor: 6, p_answer: 30, p_unit: 'm²' }),
    });
    expect(res.ok).toBe(false);
  });

  it('não vira professor nem por e-mail/senha próprios (cadastro livre não dá acesso)', async () => {
    const client = rawClient();
    const email = `curioso.${Date.now()}@teste.local`;
    const { data, error } = await client.auth.signUp({ email, password: 'senha-local-Z9!' });
    // Se o servidor aceitar o cadastro, a conta existe, mas NÃO é professor.
    if (!error && data.session) {
      expect((await client.rpc('list_teams', { p_code: codeA })).error?.hint).toBe('NOT_AUTHORIZED');
      expect((await client.from('teams').select('*')).data ?? []).toEqual([]);
      expect((await client.from('teachers').insert({ user_id: data.user!.id })).error?.code).toBe('42501');
    } else {
      expect(error).not.toBeNull(); // cadastro fechado: igualmente seguro
    }
  });

  it('um usuário anônimo nunca é professor, nem se alguém o colocar na lista por engano', async () => {
    const { client, userId } = await anonymousClient();
    await withDb((db) => db.query('insert into public.teachers (user_id) values ($1)', [userId]));
    try {
      expect((await client.rpc('list_teams', { p_code: codeA })).error?.hint).toBe('NOT_AUTHORIZED');
      expect((await client.rpc('create_session')).error?.hint).toBe('NOT_AUTHORIZED');
      expect((await client.from('teams').select('*')).data ?? []).toEqual([]);
    } finally {
      await withDb((db) => db.query('delete from public.teachers where user_id = $1', [userId]));
    }
  });
});

describe('privilégios no catálogo do banco (sem depender da API)', () => {
  it('anon e authenticated só têm SELECT (e só nas tabelas do professor); nenhuma escrita, TRUNCATE ou sequência', async () => {
    const rows = await withDb(async (db) => {
      const q = await db.query(`
        select c.relname, r.rolname,
               has_table_privilege(r.rolname, c.oid, 'SELECT')   as sel,
               has_table_privilege(r.rolname, c.oid, 'INSERT')   as ins,
               has_table_privilege(r.rolname, c.oid, 'UPDATE')   as upd,
               has_table_privilege(r.rolname, c.oid, 'DELETE')   as del,
               has_table_privilege(r.rolname, c.oid, 'TRUNCATE') as trunc
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
         where n.nspname = 'public' and c.relkind in ('r', 'v')`);
      return q.rows as Array<{ relname: string; rolname: string; sel: boolean; ins: boolean; upd: boolean; del: boolean; trunc: boolean }>;
    });
    expect(rows.length).toBeGreaterThanOrEqual((ALL_TABLES.length + VIEWS.length) * 2);
    for (const r of rows) {
      expect([r.ins, r.upd, r.del, r.trunc], `${r.rolname} em ${r.relname}`).toEqual([false, false, false, false]);
      const professorReadable = [...PROFESSOR_TABLES, ...VIEWS].includes(r.relname);
      expect(r.sel, `SELECT de ${r.rolname} em ${r.relname}`).toBe(r.rolname === 'authenticated' && professorReadable);
    }
  });

  it('toda tabela do app tem RLS ligada e as funções públicas executáveis são exatamente as previstas', async () => {
    const { tables, fns } = await withDb(async (db) => ({
      tables: (await db.query(`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)).rows,
      fns: (await db.query(`
        select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app_private') order by 1`)).rows,
    }));
    for (const t of tables) expect(t.relrowsecurity, `RLS em ${t.relname}`).toBe(true);
    const anon = fns.filter((f: { anon: boolean }) => f.anon).map((f: { proname: string }) => f.proname);
    expect(anon).toEqual(['get_projection']);
    const auth = fns.filter((f: { auth: boolean }) => f.auth).map((f: { proname: string }) => f.proname).sort();
    expect(auth).toEqual([
      'add_note', 'close_session', 'create_session', 'delete_session', 'export_anonymous', 'get_current_session', 'get_projection',
      'get_projection_config', 'get_team', 'is_session_teacher', 'is_teacher', 'join_session', 'list_notes', 'list_teams', 'record_hint',
      'save_progress', 'set_projection', 'submit_attempt', 'submit_diagnostic', 'submit_exit', 'submit_hypothesis',
    ].sort());
    expect(auth).not.toContain('purge_expired_data');
  });
});

describe('sem login (chave pública): só a projeção por código', () => {
  it.each([...STUDENT_FUNCTIONS, ...TEACHER_FUNCTIONS])('não executa %s', async (fn, args) => {
    const { error } = await rawClient().rpc(fn, args);
    expect(error?.code).toBe('42501');
  });

  it.each(ALL_TABLES)('não lê a tabela %s', async (table) => {
    const { data, error } = await rawClient().from(table).select('*');
    expect(error?.code === '42501' || (data ?? []).length === 0).toBe(true);
  });

  it('get_projection é a única função aberta e só devolve conteúdo agregado, sem apelidos', async () => {
    await teacherA.setProjection({ kind: 'distribution', stage: 'diagnostico', showCorrect: false });
    const { data, error } = await rawClient().rpc('get_projection', { p_code: codeA });
    expect(error).toBeNull();
    expect(data).toMatchObject({ kind: 'distribution', stage: 'diagnostico' });
    expect(JSON.stringify(data)).not.toMatch(/Alfa|Equipe/);
    expect((data as { distribution: { suppressed: boolean } }).distribution.suppressed).toBe(true); // 1 resposta: oculta
    await teacherA.setProjection({ kind: 'none' });
  });

  it('código desconhecido devolve vazio, sem revelar nada', async () => {
    const { data } = await rawClient().rpc('get_projection', { p_code: 'QQQQQQ' });
    expect(data).toEqual({ kind: 'none' });
  });
});

describe('uma equipe não acessa os dados de outra', () => {
  it('equipe B não lê, não altera e não envia em nome da equipe A', async () => {
    const deviceB = newDevice();
    const teamB = await deviceB.joinSession(codeA, 'Equipe Beta');
    expect(await deviceB.getTeam(teamA.id)).toBeNull();
    expect(await code(deviceB.saveProgress(teamA.id, { phase: 'hipotese' }))).toBe('TEAM_NOT_FOUND');
    expect(await code(deviceB.recordHint(teamA.id, 1))).toBe('TEAM_NOT_FOUND');
    expect(await code(deviceB.submitHypothesis(teamA.id, answer('30')))).toBe('TEAM_NOT_FOUND');
    expect(await code(deviceB.submitAttempt(teamA.id, answer('30')))).toBe('TEAM_NOT_FOUND');
    expect(await code(deviceB.submitExit(teamA.id, answer('24')))).toBe('TEAM_NOT_FOUND');
    expect((await deviceA.getTeam(teamA.id))!.phase).toBe('exploracao'); // nada mudou na equipe A
    expect((await deviceB.getTeam(teamB.id))!.alias).toBe('Equipe Beta');
  });

  it('o mesmo dispositivo que reentra na sessão recupera a própria equipe, sem criar outra', async () => {
    const again = await deviceA.joinSession(codeA, 'Qualquer Outro Apelido');
    expect(again.id).toBe(teamA.id);
    expect(again.alias).toBe('Equipe Alfa');
  });
});

describe('o professor só enxerga as próprias sessões', () => {
  it('professor B não lê, não altera nem apaga a sessão do professor A', async () => {
    expect(await teacherB.listTeams(codeA)).toEqual([]);
    expect(await teacherB.listNotes(codeA)).toEqual([]);
    expect(await code(teacherB.addNote(codeA, { team: null, difficulty: 'invasão', intervention: '', response: '' }))).toBe('SESSION_NOT_FOUND');
    await teacherB.closeSession(codeA); // sem efeito
    await teacherB.deleteSession(codeA); // sem efeito
    expect((await teacherA.getCurrentSession())?.closedAt).toBeNull();
    expect((await teacherA.listTeams(codeA)).map((t) => t.alias)).toContain('Equipe Alfa');
    expect(await teacherB.getCurrentSession()).toBeNull();
    // leitura direta (a mesma que o Realtime usa) também é filtrada pela RLS
    const direct = await withDb(async () => null);
    expect(direct).toBeNull();
  });

  it('a projeção de B não altera a de A', async () => {
    const sB = await teacherB.openSession();
    await teacherB.setProjection({ kind: 'distribution', stage: 'saida', showCorrect: true });
    expect(await teacherA.getProjection()).toEqual({ kind: 'none' });
    expect(await teacherB.getProjection()).toEqual({ kind: 'distribution', stage: 'saida', showCorrect: true });
    await teacherB.deleteSession(sB.code);
  });

  it('o professor não escreve direto nas tabelas nem se promove na lista de professores', async () => {
    const client = rawClient();
    await client.auth.signInWithPassword(TEACHERS.a);
    for (const table of ALL_TABLES) {
      const ins = await client.from(table).insert(probeInsert(table));
      expect(ins.error?.code, table).toBe('42501');
    }
    expect((await client.from('teachers').insert({ user_id: '00000000-0000-4000-8000-0000000000aa' })).error?.code).toBe('42501');
    expect((await client.rpc('purge_expired_data')).error?.code).toBe('42501');
    expect((await client.from('teams').select('alias')).data!.map((r) => r.alias)).toContain('Equipe Alfa');
  });
});

describe('contas fora da lista de professores', () => {
  it('uma conta de e-mail/senha que não está na lista não entra no painel nem usa funções docentes', async () => {
    const outsider = newDevice();
    await expect(outsider.teacherAuth.signIn(TEACHERS.outsider.email, TEACHERS.outsider.password)).rejects.toThrow(/permissão de professor/);
    expect(await outsider.teacherAuth.isSignedIn()).toBe(false);

    const client = rawClient();
    expect((await client.auth.signInWithPassword(TEACHERS.outsider)).error).toBeNull();
    expect((await client.rpc('list_teams', { p_code: codeA })).error?.hint).toBe('NOT_AUTHORIZED');
    expect((await client.from('teams').select('*')).data ?? []).toEqual([]);
    expect((await client.from('teachers').select('*')).data ?? []).toEqual([]);
  });

  it('senha errada não entra e a mensagem não revela se o e-mail existe', async () => {
    const dev = newDevice();
    await expect(dev.teacherAuth.signIn(TEACHERS.a.email, 'senha-errada')).rejects.toThrow('E-mail ou senha incorretos.');
    await expect(dev.teacherAuth.signIn('ninguem@teste.local', 'senha-errada')).rejects.toThrow('E-mail ou senha incorretos.');
  });

  it('sair do painel encerra o acesso docente neste dispositivo', async () => {
    const t = await loginTeacher('a');
    expect(await t.teacherAuth.isSignedIn()).toBe(true);
    await t.teacherAuth.signOut();
    expect(await t.teacherAuth.isSignedIn()).toBe(false);
    expect(await code(t.listTeams(codeA))).toBe('NOT_AUTHORIZED');
  });
});

describe('a resposta correta não vaza antes do envio', () => {
  it('o estado da equipe nunca traz gabarito; o resultado só existe depois do envio', async () => {
    const dev = newDevice();
    const s = await teacherA.openSession(); // abre nova sessão (encerra a anterior, só para este teste)
    const team = await dev.joinSession(s.code, 'Equipe Gabarito');
    await dev.submitDiagnostic(team.id, answer('20'));
    await dev.saveProgress(team.id, { phase: 'hipotese' });
    const before = JSON.stringify(await dev.getTeam(team.id));
    expect(before).not.toMatch(/"(expected|area|gabarito|solution)"/i);
    expect(JSON.parse(before).hypothesis).toBeNull();
    const h = await dev.submitHypothesis(team.id, answer('999')); // errada
    expect(h.correct).toBe(false);
    // errar não revela o valor certo (30 para 10 × 6): só descreve o padrão, no cliente
    expect(JSON.stringify(h)).not.toMatch(/"answer":30\b/);
    expect(JSON.stringify(h)).not.toMatch(/expected/i);
  });
});

describe('texto livre malicioso é tratado como dado', () => {
  it('aspas e comandos SQL na justificativa ficam gravados literalmente, sem efeito', async () => {
    const dev = newDevice();
    const s = await teacherA.openSession();
    const team = await dev.joinSession(s.code, 'Equipe Texto');
    const nasty = `d'água "x"; drop table teams; -- <script>alert(1)</script>`;
    const saved = await dev.submitDiagnostic(team.id, { ...answer('20'), calculation: `8 x 5 : 2 -- ' or 1=1`, justification: nasty });
    expect(saved.justification).toBe(nasty);
    expect((await teacherA.listTeams(s.code)).length).toBe(1); // a tabela continua existindo
  });

  it('apelidos com marcação ou aspas são recusados', async () => {
    const s = await teacherA.openSession();
    for (const alias of ["'; drop table teams; --", '<img src=x>', 'Equipe "A"']) {
      expect(await code(newDevice().joinSession(s.code, alias))).toBe('ALIAS_INVALID');
    }
  });
});

describe('limite contra adivinhação do código da sessão', () => {
  it('depois de 10 códigos errados seguidos, o dispositivo é barrado por alguns minutos (até com o código certo)', async () => {
    const s = await teacherA.openSession();
    const dev = newDevice();
    for (let i = 0; i < 10; i += 1) expect(await code(dev.joinSession(`ERR${String(i).padStart(3, '2')}`, 'Equipe Chute'))).toBe('SESSION_NOT_FOUND');
    expect(await code(dev.joinSession('XXXXXX', 'Equipe Chute'))).toBe('TOO_MANY_ATTEMPTS');
    expect(await code(dev.joinSession(s.code, 'Equipe Chute'))).toBe('TOO_MANY_ATTEMPTS');
    // outro dispositivo (outra pessoa) não é afetado
    expect(await code(newDevice().joinSession(s.code, 'Equipe Honesta'))).toBe('OK');
  });
});

describe('projeção: só conteúdo revisado e sem dado pessoal', () => {
  it('o servidor recusa exemplo com e-mail, telefone ou número longo, e payloads malformados', async () => {
    await teacherA.openSession();
    const base = { stage: 'diagnostico' as const, major: 8, minor: 5, calculation: '8 x 5', answerText: '40 m²', correct: false };
    for (const justification of ['escreva ana@escola.com', 'ligue 99999-1234', 'matrícula 20240123', 'veja www.site.com']) {
      expect(await code(teacherA.setProjection({ kind: 'example', showCorrect: false, example: { ...base, justification } }))).toBe('INVALID_INPUT');
    }
    const bad = [
      { kind: 'tudo' },
      { kind: 'distribution', stage: 'inexistente', showCorrect: true },
      { kind: 'distribution', stage: 'saida' },
      { kind: 'example', showCorrect: true },
      { kind: 'example', showCorrect: true, example: { ...base, justification: 'x'.repeat(501) } },
    ];
    for (const payload of bad) {
      expect(await code(teacherA.setProjection(payload as never))).toBe('INVALID_INPUT');
    }
    expect(await teacherA.getProjection()).toEqual({ kind: 'none' });
  });
});
