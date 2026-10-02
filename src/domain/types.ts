export type Unit = 'm' | 'm²';

export type PatternId =
  | 'produto_sem_metade'
  | 'soma_diagonais'
  | 'media_diagonais'
  | 'quarto_do_produto'
  | 'unidade_incorreta';

/** Fases do estudante. `hipotese` e `feedback` fazem parte da missão do Jardim. */
export type StudentPhase = 'diagnostico' | 'exploracao' | 'hipotese' | 'feedback' | 'saida' | 'concluido';

export type TeamStatus = 'entrou' | 'fez_diagnostico' | 'explorando' | 'pediu_dica' | 'tentou' | 'concluiu';

export type HintLevel = 1 | 2 | 3;

export interface Diagonals {
  /** Diagonal maior (D), em metros. */
  major: number;
  /** Diagonal menor (d), em metros. */
  minor: number;
}

/** O que a equipe preenche (texto bruto, antes de validar). */
export interface SubmissionInput {
  calculation: string;
  rawAnswer: string;
  unit: Unit | '';
  justification: string;
}

/** Registro comum a diagnóstico, tentativas e saída. */
export interface Submission extends Diagonals {
  calculation: string;
  rawAnswer: string;
  answer: number;
  unit: Unit;
  justification: string;
  correct: boolean;
  patternId: PatternId | null;
  submittedAt: number;
}

export type DiagnosticResult = Submission;

export interface Attempt extends Submission {
  n: number;
  /** Maior nível de dica já visto quando a tentativa foi enviada (0 = sem dicas). */
  hintLevel: 0 | HintLevel;
}

export type ExitResult = Submission;

export interface HintView {
  level: HintLevel;
  viewedAt: number;
}

export interface TeamRecord {
  id: string;
  sessionCode: string;
  alias: string;
  /** Equipes fictícias de demonstração (nunca estudantes reais). */
  fictitious: boolean;
  joinedAt: number;
  phase: StudentPhase;
  diagonals: Diagonals;
  exploringSince: number | null;
  diagnostic: DiagnosticResult | null;
  hints: HintView[];
  attempts: Attempt[];
  exit: ExitResult | null;
}

export interface Session {
  code: string;
  openedAt: number;
  expiresAt: number;
  closedAt: number | null;
}

export interface TeacherNote {
  id: string;
  sessionCode: string;
  /** Apelido da equipe ou null para a turma toda. */
  team: string | null;
  difficulty: string;
  intervention: string;
  response: string;
  createdAt: number;
}

export type ProjectionStage = 'diagnostico' | 'tentativa' | 'saida';

export interface AnonymousExample {
  stage: ProjectionStage;
  major: number;
  minor: number;
  calculation: string;
  answerText: string;
  justification: string;
  correct: boolean;
}

export type Projection =
  | { kind: 'none' }
  | { kind: 'distribution'; stage: ProjectionStage; showCorrect: boolean }
  | { kind: 'example'; example: AnonymousExample; showCorrect: boolean };
