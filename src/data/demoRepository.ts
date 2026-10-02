import { validateDiagonalPair } from '../domain/area';
import { evaluateAnswer, validateSubmissionInput } from '../domain/evaluate';
import { DIAGNOSTIC_PROBLEM, EXIT_PROBLEM, EXPLORATION_START } from '../domain/mission';
import { maxHintLevel } from '../domain/status';
import type {
  Attempt,
  DiagnosticResult,
  ExitResult,
  HintLevel,
  Projection,
  Session,
  Submission,
  SubmissionInput,
  TeacherNote,
  TeamRecord,
} from '../domain/types';
import type { KeyValueStore } from './kvStore';
import { RepositoryError, type ProgressPatch, type SessionRepository } from './repository';

const STORAGE_KEY = 'operacao-area/demo/v1';
const SESSION_DURATION_MS = 90 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface DemoState {
  session: Session | null;
  teams: Record<string, TeamRecord>;
  notes: TeacherNote[];
  projection: Projection;
}

export interface Clock {
  now(): number;
  random(): number;
}

const emptyState = (): DemoState => ({ session: null, teams: {}, notes: [], projection: { kind: 'none' } });

export function validateAlias(raw: string): string | null {
  const alias = raw.trim().replace(/\s+/g, ' ');
  if (alias.length < 2 || alias.length > 24) return 'O apelido deve ter de 2 a 24 caracteres.';
  if (!/^[\p{L}\p{N} _-]+$/u.test(alias)) return 'Use apenas letras, números, espaço, hífen ou sublinhado.';
  if (/\d{4,}/.test(alias)) return 'Não use números longos (como telefone ou matrícula).';
  return null;
}

/**
 * Repositório de DEMONSTRAÇÃO: tudo roda no navegador e é guardado no armazenamento local.
 * - Não há autenticação, nem servidor, nem sincronização entre dispositivos.
 * - A correção roda no próprio navegador (o gabarito está no código do app). Só na Etapa 2 a
 *   verificação passa para o servidor.
 */
export class DemoRepository implements SessionRepository {
  readonly mode = 'demo' as const;
  private nowOverride: number | null = null;

  constructor(
    private readonly store: KeyValueStore,
    private readonly clock: Clock = { now: () => Date.now(), random: () => Math.random() },
  ) {}

  private now(): number {
    return this.nowOverride ?? this.clock.now();
  }

  private load(): DemoState {
    const raw = this.store.get(STORAGE_KEY);
    if (!raw) return emptyState();
    try {
      const parsed = JSON.parse(raw) as Partial<DemoState>;
      return { ...emptyState(), ...parsed, teams: parsed.teams ?? {}, notes: parsed.notes ?? [] };
    } catch {
      return emptyState();
    }
  }

  private mutate<T>(fn: (state: DemoState) => T): T {
    const state = this.load();
    const result = fn(state);
    this.store.set(STORAGE_KEY, JSON.stringify(state));
    return result;
  }

  private newId(): string {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return `id-${Math.floor(this.clock.random() * 1e12).toString(36)}-${this.now().toString(36)}`;
  }

  private newCode(): string {
    let code = '';
    for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[Math.floor(this.clock.random() * CODE_ALPHABET.length)];
    return code;
  }

  private teamOrThrow(state: DemoState, teamId: string): TeamRecord {
    const team = state.teams[teamId];
    if (!team) throw new RepositoryError('TEAM_NOT_FOUND', 'Equipe não encontrada. Entre novamente com o código da sessão.');
    return team;
  }

  private assertSessionActive(state: DemoState, team: TeamRecord) {
    const s = state.session;
    if (!s || s.code !== team.sessionCode || s.closedAt !== null) {
      throw new RepositoryError('SESSION_CLOSED', 'A sessão foi encerrada pelo professor.');
    }
  }

  // ---------------------------------------------------------------- professor

  async openSession(): Promise<Session> {
    return this.mutate((state) => {
      const openedAt = this.now();
      const session: Session = { code: this.newCode(), openedAt, expiresAt: openedAt + SESSION_DURATION_MS, closedAt: null };
      state.session = session;
      state.projection = { kind: 'none' };
      return session;
    });
  }

  async closeSession(code: string): Promise<void> {
    this.mutate((state) => {
      if (state.session?.code === code && state.session.closedAt === null) state.session.closedAt = this.now();
    });
  }

  async getCurrentSession(): Promise<Session | null> {
    return this.load().session;
  }

  async listTeams(code: string): Promise<TeamRecord[]> {
    return Object.values(this.load().teams)
      .filter((t) => t.sessionCode === code)
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }

  async addNote(code: string, note: Omit<TeacherNote, 'id' | 'sessionCode' | 'createdAt'>): Promise<TeacherNote> {
    return this.mutate((state) => {
      if (!note.difficulty.trim() && !note.intervention.trim() && !note.response.trim()) {
        throw new RepositoryError('INVALID_INPUT', 'Preencha ao menos um dos campos da nota.');
      }
      const saved: TeacherNote = { ...note, id: this.newId(), sessionCode: code, createdAt: this.now() };
      state.notes.push(saved);
      return saved;
    });
  }

  async listNotes(code: string): Promise<TeacherNote[]> {
    return this.load().notes.filter((n) => n.sessionCode === code);
  }

  async setProjection(projection: Projection): Promise<void> {
    this.mutate((state) => {
      state.projection = projection;
    });
  }

  async getProjection(): Promise<Projection> {
    return this.load().projection;
  }

  // ---------------------------------------------------------------- estudante

  async joinSession(rawCode: string, rawAlias: string): Promise<TeamRecord> {
    return this.mutate((state) => {
      const code = rawCode.trim().toUpperCase();
      const session = state.session;
      if (!session || session.code !== code) {
        throw new RepositoryError('SESSION_NOT_FOUND', 'Código não encontrado. Confiram o código mostrado pelo professor.');
      }
      if (session.closedAt !== null || this.now() >= session.expiresAt) {
        throw new RepositoryError('SESSION_CLOSED', 'Essa sessão não está aberta. Peçam um novo código ao professor.');
      }
      const aliasError = validateAlias(rawAlias);
      if (aliasError) throw new RepositoryError('ALIAS_INVALID', aliasError);
      const alias = rawAlias.trim().replace(/\s+/g, ' ');
      const taken = Object.values(state.teams).some(
        (t) => t.sessionCode === code && t.alias.toLocaleLowerCase('pt-BR') === alias.toLocaleLowerCase('pt-BR'),
      );
      if (taken) throw new RepositoryError('ALIAS_TAKEN', 'Já existe uma equipe com esse apelido. Escolham outro.');

      const team: TeamRecord = {
        id: this.newId(),
        sessionCode: code,
        alias,
        fictitious: false,
        joinedAt: this.now(),
        phase: 'diagnostico',
        diagonals: { ...EXPLORATION_START },
        exploringSince: null,
        diagnostic: null,
        hints: [],
        attempts: [],
        exit: null,
      };
      state.teams[team.id] = team;
      return team;
    });
  }

  async getTeam(teamId: string): Promise<TeamRecord | null> {
    return this.load().teams[teamId] ?? null;
  }

  async saveProgress(teamId: string, patch: ProgressPatch): Promise<TeamRecord> {
    return this.mutate((state) => {
      const team = this.teamOrThrow(state, teamId);
      this.assertSessionActive(state, team);
      if (team.exit) throw new RepositoryError('INVALID_STATE', 'A missão já foi concluída.');

      if (patch.diagonals) {
        if (team.phase !== 'exploracao') throw new RepositoryError('INVALID_STATE', 'As medidas só podem mudar na exploração.');
        const error = validateDiagonalPair(patch.diagonals.major, patch.diagonals.minor);
        if (error) throw new RepositoryError('INVALID_INPUT', error);
        const changed = patch.diagonals.major !== team.diagonals.major || patch.diagonals.minor !== team.diagonals.minor;
        team.diagonals = { ...patch.diagonals };
        if (changed && team.exploringSince === null) team.exploringSince = this.now();
      }

      if (patch.phase) {
        const from = team.phase;
        const to = patch.phase;
        const allowed =
          (from === 'exploracao' && to === 'hipotese') ||
          (from === 'hipotese' && to === 'exploracao') ||
          (from === 'feedback' && to === 'exploracao') ||
          (from === 'feedback' && to === 'saida' && team.attempts.length > 0);
        if (!allowed) throw new RepositoryError('INVALID_STATE', `Não é possível ir de "${from}" para "${to}".`);
        team.phase = to;
        if (team.exploringSince === null && to !== 'saida') team.exploringSince = this.now();
      }
      return team;
    });
  }

  private buildSubmission(input: SubmissionInput, major: number, minor: number): Submission {
    const check = validateSubmissionInput(input);
    if (!check.ok) throw new RepositoryError('INVALID_INPUT', Object.values(check.errors)[0] ?? 'Dados inválidos.');
    const { correct, patternId } = evaluateAnswer(major, minor, check.value.answer, check.value.unit);
    return {
      major,
      minor,
      calculation: check.value.calculation,
      rawAnswer: check.value.rawAnswer,
      answer: check.value.answer,
      unit: check.value.unit,
      justification: check.value.justification,
      correct,
      patternId,
      submittedAt: this.now(),
    };
  }

  async submitDiagnostic(teamId: string, input: SubmissionInput): Promise<DiagnosticResult> {
    return this.mutate((state) => {
      const team = this.teamOrThrow(state, teamId);
      this.assertSessionActive(state, team);
      if (team.phase !== 'diagnostico' || team.diagnostic) {
        throw new RepositoryError('INVALID_STATE', 'O diagnóstico já foi enviado.');
      }
      const { major, minor } = DIAGNOSTIC_PROBLEM.measures;
      const result = this.buildSubmission(input, major, minor);
      team.diagnostic = result;
      team.phase = 'exploracao';
      return result;
    });
  }

  async recordHint(teamId: string, level: HintLevel): Promise<TeamRecord> {
    return this.mutate((state) => {
      const team = this.teamOrThrow(state, teamId);
      this.assertSessionActive(state, team);
      if (!team.diagnostic) throw new RepositoryError('INVALID_STATE', 'As dicas só ficam disponíveis depois do diagnóstico.');
      if (team.exit || team.phase === 'saida' || team.phase === 'concluido') {
        throw new RepositoryError('INVALID_STATE', 'O problema final é resolvido sem dicas.');
      }
      if (![1, 2, 3].includes(level)) throw new RepositoryError('INVALID_INPUT', 'Dica inexistente.');
      const current = maxHintLevel(team);
      if (level <= current) return team; // já vista: não duplica o registro
      if (level !== current + 1) throw new RepositoryError('INVALID_STATE', 'As dicas são liberadas em ordem.');
      team.hints.push({ level, viewedAt: this.now() });
      return team;
    });
  }

  async submitAttempt(teamId: string, input: SubmissionInput): Promise<Attempt> {
    return this.mutate((state) => {
      const team = this.teamOrThrow(state, teamId);
      this.assertSessionActive(state, team);
      if (!team.diagnostic || team.phase !== 'hipotese') {
        throw new RepositoryError('INVALID_STATE', 'Registrem a hipótese depois de explorar o jardim.');
      }
      const submission = this.buildSubmission(input, team.diagonals.major, team.diagonals.minor);
      const attempt: Attempt = { ...submission, n: team.attempts.length + 1, hintLevel: maxHintLevel(team) };
      team.attempts.push(attempt);
      team.phase = 'feedback';
      return attempt;
    });
  }

  async submitExit(teamId: string, input: SubmissionInput): Promise<ExitResult> {
    return this.mutate((state) => {
      const team = this.teamOrThrow(state, teamId);
      this.assertSessionActive(state, team);
      if (team.phase !== 'saida' || team.exit) throw new RepositoryError('INVALID_STATE', 'O problema final não está disponível.');
      const { major, minor } = EXIT_PROBLEM.measures;
      const result = this.buildSubmission(input, major, minor);
      team.exit = result;
      team.phase = 'concluido';
      return result;
    });
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  // ------------------------------------------------------ somente demonstração

  /**
   * Cria equipes FICTÍCIAS (marcadas como tal) passando pelos mesmos métodos que os estudantes usam.
   * Servem apenas para ensaiar o painel; não representam estudantes nem resultados reais.
   */
  async seedFictitiousTeams(code: string): Promise<void> {
    const base = this.clock.now();
    const text = { calculation: 'Cálculo fictício', justification: 'Justificativa fictícia de exemplo.' };
    const sub = (rawAnswer: string, unit: 'm' | 'm²' = 'm²'): SubmissionInput => ({ ...text, rawAnswer, unit });
    const hint = async (id: string, level: HintLevel, at: number) => {
      this.nowOverride = at;
      await this.recordHint(id, level);
    };

    const scripts: Array<{ alias: string; run: (id: string, t: number) => Promise<void> }> = [
      { alias: 'Fictícia Aurora', run: async () => {} },
      {
        alias: 'Fictícia Brisa',
        run: async (id, t) => {
          this.nowOverride = t + 1000;
          await this.submitDiagnostic(id, sub('20'));
        },
      },
      {
        alias: 'Fictícia Cacto',
        run: async (id, t) => {
          this.nowOverride = t + 1000;
          await this.submitDiagnostic(id, sub('40'));
          this.nowOverride = t + 2000;
          await this.saveProgress(id, { diagonals: { major: 12, minor: 6 } });
        },
      },
      {
        alias: 'Fictícia Delta',
        run: async (id, t) => {
          this.nowOverride = t + 1000;
          await this.submitDiagnostic(id, sub('40'));
          this.nowOverride = t + 2000;
          await this.saveProgress(id, { phase: 'hipotese' });
          this.nowOverride = t + 3000;
          await this.submitAttempt(id, sub('60'));
          await hint(id, 1, t + 4000);
        },
      },
      {
        alias: 'Fictícia Eclipse',
        run: async (id, t) => {
          this.nowOverride = t + 1000;
          await this.submitDiagnostic(id, sub('13'));
          this.nowOverride = t + 2000;
          await this.saveProgress(id, { phase: 'hipotese' });
          this.nowOverride = t + 3000;
          await this.submitAttempt(id, sub('60'));
          this.nowOverride = t + 3500;
          await this.saveProgress(id, { phase: 'exploracao' });
          this.nowOverride = t + 3600;
          await this.saveProgress(id, { phase: 'hipotese' });
          this.nowOverride = t + 4000;
          await this.submitAttempt(id, sub('16'));
        },
      },
      {
        alias: 'Fictícia Farol',
        run: async (id, t) => {
          this.nowOverride = t + 1000;
          await this.submitDiagnostic(id, sub('40'));
          this.nowOverride = t + 2000;
          await this.saveProgress(id, { phase: 'hipotese' });
          this.nowOverride = t + 3000;
          await this.submitAttempt(id, sub('60'));
          await hint(id, 1, t + 4000);
          await hint(id, 2, t + 5000);
          this.nowOverride = t + 6000;
          await this.saveProgress(id, { phase: 'exploracao' });
          this.nowOverride = t + 6100;
          await this.saveProgress(id, { phase: 'hipotese' });
          this.nowOverride = t + 7000;
          await this.submitAttempt(id, sub('30'));
          this.nowOverride = t + 8000;
          await this.saveProgress(id, { phase: 'saida' });
          this.nowOverride = t + 9000;
          await this.submitExit(id, sub('24'));
        },
      },
      {
        alias: 'Fictícia Girassol',
        run: async (id, t) => {
          this.nowOverride = t + 1000;
          await this.submitDiagnostic(id, sub('20'));
          this.nowOverride = t + 2000;
          await this.saveProgress(id, { phase: 'hipotese' });
          this.nowOverride = t + 3000;
          await this.submitAttempt(id, sub('30'));
          this.nowOverride = t + 4000;
          await this.saveProgress(id, { phase: 'saida' });
          this.nowOverride = t + 5000;
          await this.submitExit(id, sub('48'));
        },
      },
    ];

    try {
      for (let i = 0; i < scripts.length; i += 1) {
        const t = base - (scripts.length - i) * 60_000;
        const id = this.mutate((state) => {
          const team: TeamRecord = {
            id: this.newId(),
            sessionCode: code,
            alias: scripts[i].alias,
            fictitious: true,
            joinedAt: t,
            phase: 'diagnostico',
            diagonals: { ...EXPLORATION_START },
            exploringSince: null,
            diagnostic: null,
            hints: [],
            attempts: [],
            exit: null,
          };
          state.teams[team.id] = team;
          return team.id;
        });
        await scripts[i].run(id, t);
      }
    } finally {
      this.nowOverride = null;
    }
  }

  async removeFictitiousTeams(code: string): Promise<void> {
    this.mutate((state) => {
      for (const [id, team] of Object.entries(state.teams)) {
        if (team.sessionCode === code && team.fictitious) delete state.teams[id];
      }
    });
  }

  async resetAll(): Promise<void> {
    this.store.remove(STORAGE_KEY);
  }
}
