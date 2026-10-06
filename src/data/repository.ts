import type {
  Attempt,
  DiagnosticResult,
  Diagonals,
  ExitResult,
  HintLevel,
  HypothesisResult,
  Projection,
  ProjectionView,
  Session,
  StudentPhase,
  SubmissionInput,
  TeacherNote,
  TeamRecord,
} from '../domain/types';

/** DEMONSTRAÇÃO = dados só neste navegador. CONECTADO = backend real (Supabase). */
export type RepositoryMode = 'demo' | 'connected';

export type RepositoryErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'ALIAS_INVALID'
  | 'ALIAS_TAKEN'
  | 'TEAM_NOT_FOUND'
  | 'INVALID_STATE'
  | 'INVALID_INPUT'
  | 'NOT_AUTHORIZED'
  /** Muitas tentativas de código errado. */
  | 'TOO_MANY_ATTEMPTS'
  /** O serviço de login limitou as entradas vindas da mesma rede/IP. */
  | 'RATE_LIMITED'
  | 'NETWORK';

export class RepositoryError extends Error {
  constructor(
    public readonly code: RepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

export interface ProgressPatch {
  phase?: Extract<StudentPhase, 'exploracao' | 'hipotese' | 'saida'>;
  diagonals?: Diagonals;
}

export type ConnectionState = 'connected' | 'reconnecting' | 'offline';

/** Indicador de conexão (só repositórios conectados). */
export interface ConnectionMonitor {
  get(): ConnectionState;
  subscribe(listener: () => void): () => void;
}

/** Login da conta docente (só repositórios conectados). */
export interface TeacherAuth {
  isSignedIn(): Promise<boolean>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

/**
 * Contrato de dados do app. Duas implementações, com o MESMO comportamento observável
 * (verificado pelos testes de contrato): `DemoRepository` (navegador) e `SupabaseRepository` (conectado).
 *
 * Trajetória registrada: diagnóstico → hipótese inicial → tentativas/revisões → saída final.
 */
export interface SessionRepository {
  readonly mode: RepositoryMode;
  readonly connection?: ConnectionMonitor;
  readonly teacherAuth?: TeacherAuth;
  /** Libera conexões e temporizadores (repositório conectado). */
  dispose?(): Promise<void>;

  // Professor
  openSession(): Promise<Session>;
  closeSession(code: string): Promise<void>;
  /** Apaga a sessão e TODOS os dados dela (equipes, respostas, dicas, notas, projeção). */
  deleteSession(code: string): Promise<void>;
  getCurrentSession(): Promise<Session | null>;
  listTeams(code: string): Promise<TeamRecord[]>;
  addNote(code: string, note: Omit<TeacherNote, 'id' | 'sessionCode' | 'createdAt'>): Promise<TeacherNote>;
  listNotes(code: string): Promise<TeacherNote[]>;
  setProjection(projection: Projection): Promise<void>;
  getProjection(): Promise<Projection>;

  /**
   * Visão para a TV: só conteúdo agregado ou exemplo já revisado. Em modo conectado é calculada no servidor
   * e pode ser lida sem login, apenas com o código da sessão.
   */
  getProjectionView(code?: string): Promise<ProjectionView>;

  // Estudante
  joinSession(code: string, alias: string): Promise<TeamRecord>;
  getTeam(teamId: string): Promise<TeamRecord | null>;
  saveProgress(teamId: string, patch: ProgressPatch): Promise<TeamRecord>;
  submitDiagnostic(teamId: string, input: SubmissionInput): Promise<DiagnosticResult>;
  recordHint(teamId: string, level: HintLevel): Promise<TeamRecord>;
  /** Hipótese inicial: a primeira proposta da equipe, registrada uma única vez, antes das tentativas. */
  submitHypothesis(teamId: string, input: SubmissionInput): Promise<HypothesisResult>;
  /** Tentativa/revisão (depois da hipótese inicial). */
  submitAttempt(teamId: string, input: SubmissionInput): Promise<Attempt>;
  submitExit(teamId: string, input: SubmissionInput): Promise<ExitResult>;

  /**
   * Chamado a cada mudança de dados. Retorna a função que cancela a assinatura.
   * `intervalMs` é uma sugestão de intervalo de consulta quando não há tempo real (repositório conectado).
   */
  subscribe(listener: () => void, options?: { intervalMs?: number }): () => void;

  // Somente DEMONSTRAÇÃO
  seedFictitiousTeams?(code: string): Promise<void>;
  removeFictitiousTeams?(code: string): Promise<void>;
  resetAll?(): Promise<void>;
}
