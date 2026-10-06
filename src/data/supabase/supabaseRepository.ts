import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import type {
  Attempt,
  DiagnosticResult,
  ExitResult,
  HintLevel,
  HypothesisResult,
  Projection,
  ProjectionView,
  Session,
  SubmissionInput,
  TeacherNote,
  TeamRecord,
} from '../../domain/types';
import {
  RepositoryError,
  type ConnectionMonitor,
  type ConnectionState,
  type ProgressPatch,
  type RepositoryErrorCode,
  type SessionRepository,
  type TeacherAuth,
} from '../repository';

export interface SupabaseRepositoryOptions {
  url: string;
  /** Chave PÚBLICA (anon/publishable). Nunca a chave secreta/service_role. */
  anonKey: string;
  /** Onde guardar o login anônimo do estudante. Padrão: sessionStorage (uma equipe por aba, como na DEMONSTRAÇÃO). */
  studentStorage?: SupportedStorage;
  /** Onde guardar o login do professor. Padrão: localStorage. */
  teacherStorage?: SupportedStorage;
  /** Intervalo de consulta quando não há tempo real. Padrão: 5000 ms. */
  pollMs?: number;
  /** Com o tempo real saudável, recarrega mesmo assim a cada tanto (rede de segurança contra falha silenciosa). Padrão: 15000 ms. */
  reconcileMs?: number;
  /** Tempo fora do ar antes de recriar o canal de tempo real (dobra a cada falha, até 30 s). Padrão: 6000 ms. */
  rejoinMs?: number;
  /** Tentativas de reenvio em falhas de rede. Padrão: 4 (espera 400 ms, 800 ms, 1,6 s...). */
  retries?: number;
  retryBaseMs?: number;
  /** Para testes: desliga a renovação automática de token (evita temporizadores abertos). */
  autoRefreshToken?: boolean;
  /** Para testes: substitui o `fetch` (ex.: simular queda de rede). */
  fetch?: typeof fetch;
}

const KNOWN_CODES = new Set<RepositoryErrorCode>([
  'SESSION_NOT_FOUND', 'SESSION_CLOSED', 'ALIAS_INVALID', 'ALIAS_TAKEN', 'TEAM_NOT_FOUND',
  'INVALID_STATE', 'INVALID_INPUT', 'NOT_AUTHORIZED', 'TOO_MANY_ATTEMPTS', 'RATE_LIMITED', 'NETWORK',
]);

interface RpcResult {
  data: unknown;
  error: { message?: string; hint?: string | null; code?: string; details?: string | null } | null;
  status?: number;
}

const RATE_LIMIT_MESSAGE =
  'Muitas equipes entraram ao mesmo tempo pela mesma rede. Aguardem alguns minutos e tentem de novo, ou chamem o professor.';
const NETWORK_MESSAGE = 'Sem conexão com o servidor. Verifiquem o Wi-Fi e tentem de novo; o envio será repetido sem duplicar.';

function isTransient(result: RpcResult): boolean {
  if (!result.error) return false;
  if ((result.status ?? 0) >= 500) return true;
  const e = result.error;
  // Falha de rede: o cliente HTTP devolve a mensagem do fetch, sem código do banco nem dica.
  return !e.hint && !e.code && /fetch|network|ECONN|ENOTFOUND|EAI_AGAIN|timeout|socket|aborted/i.test(e.message ?? '');
}

function toRepositoryError(result: RpcResult): RepositoryError {
  const e = result.error!;
  const hint = (e.hint ?? '') as RepositoryErrorCode;
  if (KNOWN_CODES.has(hint)) return new RepositoryError(hint, e.message ?? 'Operação recusada.');
  if (isTransient(result)) return new RepositoryError('NETWORK', NETWORK_MESSAGE);
  if (result.status === 401 || result.status === 403 || e.code === '42501') {
    return new RepositoryError('NOT_AUTHORIZED', 'Acesso negado.');
  }
  return new RepositoryError('INVALID_STATE', e.message ?? 'Operação não concluída.');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function newUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

function defaultStorage(kind: 'session' | 'local'): SupportedStorage | undefined {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Repositório CONECTADO (Supabase). Mesmo contrato do `DemoRepository`.
 *  - Estudantes: login anônimo; só chamam funções do servidor (RPC). A correção é feita no servidor.
 *  - Professor: login com e-mail/senha + lista de professores autorizados no banco.
 *  - TV/projeção: chave pública, sem login; só recebe conteúdo agregado ou exemplo revisado.
 */
export class SupabaseRepository implements SessionRepository {
  readonly mode = 'connected' as const;
  readonly connection: ConnectionMonitor;
  readonly teacherAuth: TeacherAuth;

  private readonly student: SupabaseClient;
  private readonly teacher: SupabaseClient;
  private readonly anon: SupabaseClient;
  private readonly opts: Required<Pick<SupabaseRepositoryOptions, 'pollMs' | 'retries' | 'retryBaseMs' | 'rejoinMs' | 'reconcileMs'>>;

  private connState: ConnectionState = 'connected';
  private connListeners = new Set<() => void>();
  private studentReady: Promise<boolean> | null = null;

  private listeners = new Map<() => void, number>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private realtime: ReturnType<SupabaseClient['channel']> | null = null;
  private realtimeHealthy = false;
  private unhealthySince = 0;
  private lastNotify = 0;
  private rejoinAttempts = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineHandler = () => this.setConn('reconnecting');
  private offlineHandler = () => this.setConn('offline');

  constructor(options: SupabaseRepositoryOptions) {
    const refresh = options.autoRefreshToken ?? true;
    const make = (storageKey: string, storage: SupportedStorage | undefined, persist: boolean) =>
      createClient(options.url, options.anonKey, {
        auth: { persistSession: persist, storage, storageKey, autoRefreshToken: persist && refresh, detectSessionInUrl: false },
        ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
      });
    this.student = make('operacao-area-estudante', options.studentStorage ?? defaultStorage('session'), true);
    this.teacher = make('operacao-area-professor', options.teacherStorage ?? defaultStorage('local'), true);
    this.anon = make('operacao-area-publico', undefined, false);
    this.opts = { pollMs: options.pollMs ?? 5000, retries: options.retries ?? 4, retryBaseMs: options.retryBaseMs ?? 400, rejoinMs: options.rejoinMs ?? 6000, reconcileMs: options.reconcileMs ?? 15_000 };

    this.connection = {
      get: () => this.connState,
      subscribe: (l) => {
        this.connListeners.add(l);
        return () => this.connListeners.delete(l);
      },
    };
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', this.onlineHandler);
      window.addEventListener('offline', this.offlineHandler);
    }

    this.teacherAuth = {
      isSignedIn: async () => {
        const { data } = await this.teacher.auth.getSession();
        if (!data.session) return false;
        return this.isTeacherAccount();
      },
      signIn: async (email, password) => {
        const { error } = await this.teacher.auth.signInWithPassword({ email, password });
        if (error) {
          throw new Error(/invalid login/i.test(error.message) ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar. Tente de novo.');
        }
        if (!(await this.isTeacherAccount())) {
          await this.teacher.auth.signOut();
          throw new Error('Esta conta não tem permissão de professor.');
        }
        this.restartRealtime();
      },
      signOut: async () => {
        await this.stopRealtime();
        await this.teacher.auth.signOut();
      },
    };
  }

  // ------------------------------------------------------------------ infraestrutura

  private setConn(state: ConnectionState) {
    if (state === this.connState) return;
    this.connState = state;
    this.connListeners.forEach((l) => l());
  }

  private async isTeacherAccount(): Promise<boolean> {
    const { data, error } = await this.teacher.from('teachers').select('user_id').maybeSingle();
    return !error && !!data;
  }

  /** Chama uma função do servidor, repetindo em falhas de rede (os envios levam um identificador, então repetir não duplica). */
  private async rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
    let attempt = 0;
    for (;;) {
      let result: RpcResult;
      try {
        result = (await client.rpc(name, args)) as unknown as RpcResult;
      } catch (e) {
        result = { data: null, error: { message: String((e as Error)?.message ?? e) } };
      }
      if (!result.error) {
        this.setConn(this.realtime && !this.realtimeHealthy ? 'reconnecting' : 'connected');
        return result.data as T;
      }
      if (isTransient(result) && attempt < this.opts.retries) {
        this.setConn('reconnecting');
        await sleep(this.opts.retryBaseMs * 2 ** attempt + Math.floor(Math.random() * 100));
        attempt += 1;
        continue;
      }
      if (isTransient(result)) this.setConn('offline');
      throw toRepositoryError(result);
    }
  }

  /** Garante que este dispositivo tem um login anônimo (criado só quando precisa, ao entrar na sessão). */
  private async ensureStudent(create: boolean): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      const { data } = await this.student.auth.getSession();
      if (data.session) return true;
      if (!create) return false;
      const { error } = await this.student.auth.signInAnonymously();
      if (!error) return true;
      const status = (error as { status?: number }).status;
      if (status === 429 || /rate limit/i.test(error.message)) throw new RepositoryError('RATE_LIMITED', RATE_LIMIT_MESSAGE);
      if (status === 422 || /signups? (not allowed|disabled)|anonymous/i.test(error.message)) {
        throw new RepositoryError('NOT_AUTHORIZED', 'O acesso de estudantes não está habilitado neste servidor.');
      }
      throw new RepositoryError('NETWORK', NETWORK_MESSAGE);
    };
    // Chamadas simultâneas esperam a anterior (assim o login anônimo é criado uma só vez por dispositivo).
    while (this.studentReady) await this.studentReady.catch(() => undefined);
    const p = run();
    this.studentReady = p;
    try {
      return await p;
    } finally {
      if (this.studentReady === p) this.studentReady = null;
    }
  }

  // ------------------------------------------------------------------ professor

  async openSession(): Promise<Session> {
    return this.rpc<Session>(this.teacher, 'create_session');
  }

  async closeSession(code: string): Promise<void> {
    await this.rpc(this.teacher, 'close_session', { p_code: code });
  }

  async deleteSession(code: string): Promise<void> {
    await this.rpc(this.teacher, 'delete_session', { p_code: code });
  }

  async getCurrentSession(): Promise<Session | null> {
    return this.rpc<Session | null>(this.teacher, 'get_current_session');
  }

  async listTeams(code: string): Promise<TeamRecord[]> {
    return this.rpc<TeamRecord[]>(this.teacher, 'list_teams', { p_code: code });
  }

  async addNote(code: string, note: Omit<TeacherNote, 'id' | 'sessionCode' | 'createdAt'>): Promise<TeacherNote> {
    return this.rpc<TeacherNote>(this.teacher, 'add_note', {
      p_code: code,
      p_team_alias: note.team,
      p_difficulty: note.difficulty,
      p_intervention: note.intervention,
      p_response: note.response,
    });
  }

  async listNotes(code: string): Promise<TeacherNote[]> {
    return this.rpc<TeacherNote[]>(this.teacher, 'list_notes', { p_code: code });
  }

  async setProjection(projection: Projection): Promise<void> {
    await this.rpc(this.teacher, 'set_projection', { p_payload: projection });
  }

  async getProjection(): Promise<Projection> {
    return this.rpc<Projection>(this.teacher, 'get_projection_config');
  }

  async getProjectionView(code?: string): Promise<ProjectionView> {
    let target = code;
    if (!target) {
      const { data } = await this.teacher.auth.getSession();
      if (!data.session) return { kind: 'none' };
      target = (await this.getCurrentSession())?.code;
    }
    if (!target) return { kind: 'none' };
    return this.rpc<ProjectionView>(this.anon, 'get_projection', { p_code: target });
  }

  // ------------------------------------------------------------------ estudante

  async joinSession(code: string, alias: string): Promise<TeamRecord> {
    await this.ensureStudent(true);
    const res = await this.rpc<{ ok: boolean; code?: RepositoryErrorCode; message?: string; team?: TeamRecord }>(
      this.student,
      'join_session',
      { p_code: code, p_alias: alias },
    );
    if (!res.ok) throw new RepositoryError(res.code ?? 'INVALID_STATE', res.message ?? 'Não foi possível entrar.');
    return res.team!;
  }

  async getTeam(teamId: string): Promise<TeamRecord | null> {
    if (!(await this.ensureStudent(false))) return null;
    return this.rpc<TeamRecord | null>(this.student, 'get_team', { p_team: teamId });
  }

  async saveProgress(teamId: string, patch: ProgressPatch): Promise<TeamRecord> {
    return this.rpc<TeamRecord>(this.student, 'save_progress', {
      p_team: teamId,
      p_phase: patch.phase ?? null,
      p_major: patch.diagonals?.major ?? null,
      p_minor: patch.diagonals?.minor ?? null,
    });
  }

  async recordHint(teamId: string, level: HintLevel): Promise<TeamRecord> {
    return this.rpc<TeamRecord>(this.student, 'record_hint', { p_team: teamId, p_level: level });
  }

  private submit<T>(fn: string, teamId: string, input: SubmissionInput): Promise<T> {
    return this.rpc<T>(this.student, fn, {
      p_team: teamId,
      p_calculation: input.calculation,
      p_raw_answer: input.rawAnswer,
      p_unit: input.unit,
      p_justification: input.justification,
      p_request_id: input.requestId ?? newUuid(), // o mesmo id vale nas repetições automáticas deste envio
    });
  }

  submitDiagnostic(teamId: string, input: SubmissionInput): Promise<DiagnosticResult> {
    return this.submit('submit_diagnostic', teamId, input);
  }
  submitHypothesis(teamId: string, input: SubmissionInput): Promise<HypothesisResult> {
    return this.submit('submit_hypothesis', teamId, input);
  }
  submitAttempt(teamId: string, input: SubmissionInput): Promise<Attempt> {
    return this.submit('submit_attempt', teamId, input);
  }
  submitExit(teamId: string, input: SubmissionInput): Promise<ExitResult> {
    return this.submit('submit_exit', teamId, input);
  }

  // ------------------------------------------------------------------ tempo real

  /**
   * Professor: escuta mudanças no banco (Realtime) e, se o canal cair, consulta a cada `pollMs`.
   * Estudante/TV: só consulta periodicamente (`intervalMs`).
   */
  subscribe(listener: () => void, options?: { intervalMs?: number }): () => void {
    this.listeners.set(listener, options?.intervalMs ?? this.opts.pollMs);
    if (this.listeners.size === 1) void this.startRealtime();
    this.restartPoll();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        void this.stopRealtime();
        this.stopPoll();
      } else {
        this.restartPoll();
      }
    };
  }

  private notify() {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.lastNotify = Date.now();
      [...this.listeners.keys()].forEach((l) => l());
    }, 150);
  }

  private restartPoll() {
    this.stopPoll();
    if (this.listeners.size === 0) return;
    const interval = Math.min(...this.listeners.values());
    this.pollTimer = setInterval(() => {
      // Sem tempo real: consulta a cada intervalo. Com tempo real saudável: só reconcilia de vez em quando.
      if (!this.realtimeHealthy || Date.now() - this.lastNotify >= this.opts.reconcileMs) this.notify();
    }, interval);
  }

  private stopPoll() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async startRealtime() {
    if (this.realtime) return;
    const { data } = await this.teacher.auth.getSession();
    if (!data.session || this.listeners.size === 0) return; // sem professor logado: só consulta periódica
    const channel = this.teacher.channel(`operacao-area-${newUuid()}`);
    for (const table of ['teams', 'submissions', 'hint_events', 'interventions', 'projection', 'sessions']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => this.notify());
    }
    channel.subscribe((status) => {
      if (this.realtime !== channel) return; // canal antigo, já substituído
      if (status === 'SUBSCRIBED') {
        this.realtimeHealthy = true;
        this.rejoinAttempts = 0;
        this.setConn('connected');
        this.notify(); // recarrega: pode ter perdido eventos enquanto reconectava
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (this.realtimeHealthy || this.unhealthySince === 0) this.unhealthySince = Date.now();
        this.realtimeHealthy = false;
        this.setConn('reconnecting');
      }
    });
    this.realtime = channel;
    this.unhealthySince = 0;
    // Vigia: se o canal não se recupera sozinho (ex.: o serviço de tempo real reiniciou), recria-o com espera crescente.
    if (!this.watchdog) {
      this.watchdog = setInterval(() => {
        if (!this.realtime || this.realtimeHealthy) return;
        if (this.unhealthySince === 0) this.unhealthySince = Date.now();
        const wait = Math.min(30_000, this.opts.rejoinMs * 2 ** this.rejoinAttempts);
        if (Date.now() - this.unhealthySince >= wait) {
          this.rejoinAttempts += 1;
          this.unhealthySince = 0;
          // O socket antigo pode ficar preso em "conectando" depois que o servidor reinicia: derruba e recria tudo.
          void this.stopRealtime()
            .then(() => this.teacher.realtime.disconnect())
            .then(() => (this.listeners.size > 0 ? this.startRealtime() : undefined));
        }
      }, Math.max(100, Math.min(1000, Math.floor(this.opts.rejoinMs / 2))));
    }
  }

  private async stopRealtime() {
    const ch = this.realtime;
    this.realtime = null;
    this.realtimeHealthy = false;
    if (this.watchdog && this.listeners.size === 0) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    if (ch) await this.teacher.removeChannel(ch);
  }

  private restartRealtime() {
    void this.stopRealtime().then(() => (this.listeners.size > 0 ? this.startRealtime() : undefined));
  }

  /** Estado do tempo real (para testes e diagnóstico). */
  get realtimeState(): 'off' | 'connecting' | 'subscribed' {
    return !this.realtime ? 'off' : this.realtimeHealthy ? 'subscribed' : 'connecting';
  }

  async dispose(): Promise<void> {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.stopPoll();
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = null;
    this.listeners.clear();
    await this.stopRealtime();
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('online', this.onlineHandler);
      window.removeEventListener('offline', this.offlineHandler);
    }
    for (const c of [this.student, this.teacher, this.anon]) {
      await c.auth.stopAutoRefresh();
      await c.removeAllChannels();
    }
  }
}
