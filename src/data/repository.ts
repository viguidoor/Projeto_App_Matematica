import type {
  Attempt,
  DiagnosticResult,
  Diagonals,
  ExitResult,
  HintLevel,
  Projection,
  Session,
  StudentPhase,
  SubmissionInput,
  TeacherNote,
  TeamRecord,
} from '../domain/types';

/** DEMONSTRAÇÃO = dados só neste navegador. CONECTADO = Firebase (Etapa 2, ainda não existe). */
export type RepositoryMode = 'demo' | 'connected';

export type RepositoryErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'ALIAS_INVALID'
  | 'ALIAS_TAKEN'
  | 'TEAM_NOT_FOUND'
  | 'INVALID_STATE'
  | 'INVALID_INPUT';

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

/**
 * Contrato de dados do app. A Etapa 1 implementa só `DemoRepository`.
 * A Etapa 2 implementará a mesma interface sobre Firebase, com a correção e as
 * permissões validadas no servidor.
 */
export interface SessionRepository {
  readonly mode: RepositoryMode;

  // Professor
  openSession(): Promise<Session>;
  closeSession(code: string): Promise<void>;
  getCurrentSession(): Promise<Session | null>;
  listTeams(code: string): Promise<TeamRecord[]>;
  addNote(code: string, note: Omit<TeacherNote, 'id' | 'sessionCode' | 'createdAt'>): Promise<TeacherNote>;
  listNotes(code: string): Promise<TeacherNote[]>;
  setProjection(projection: Projection): Promise<void>;
  getProjection(): Promise<Projection>;

  // Estudante
  joinSession(code: string, alias: string): Promise<TeamRecord>;
  getTeam(teamId: string): Promise<TeamRecord | null>;
  saveProgress(teamId: string, patch: ProgressPatch): Promise<TeamRecord>;
  submitDiagnostic(teamId: string, input: SubmissionInput): Promise<DiagnosticResult>;
  recordHint(teamId: string, level: HintLevel): Promise<TeamRecord>;
  submitAttempt(teamId: string, input: SubmissionInput): Promise<Attempt>;
  submitExit(teamId: string, input: SubmissionInput): Promise<ExitResult>;

  /** Chamado a cada mudança de dados. Retorna a função que cancela a assinatura. */
  subscribe(listener: () => void): () => void;

  // Somente DEMONSTRAÇÃO
  seedFictitiousTeams?(code: string): Promise<void>;
  removeFictitiousTeams?(code: string): Promise<void>;
  resetAll?(): Promise<void>;
}
