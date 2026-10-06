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
  /**
   * Identificador único deste envio. Repetir o mesmo `requestId` (por exemplo, depois de uma queda de rede)
   * devolve o registro já gravado em vez de duplicá-lo.
   */
  requestId?: string;
}

/** Registro comum a diagnóstico, hipótese inicial, tentativas e saída. */
export interface Submission extends Diagonals {
  calculation: string;
  rawAnswer: string;
  answer: number;
  unit: Unit;
  justification: string;
  correct: boolean;
  patternId: PatternId | null;
  submittedAt: number;
  /**
   * Maior dica já vista quando o registro foi enviado (0 = nenhuma).
   * No diagnóstico e na saída é sempre 0: essas tarefas não oferecem dicas.
   */
  hintLevel: 0 | HintLevel;
}

export type DiagnosticResult = Submission;
/** Primeira proposta da equipe para a área do jardim, registrada uma única vez, antes de qualquer revisão. */
export type HypothesisResult = Submission;

/** Tentativa/revisão posterior à hipótese inicial. */
export interface Attempt extends Submission {
  n: number;
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
  hypothesis: HypothesisResult | null;
  hints: HintView[];
  /** Tentativas/revisões feitas depois da hipótese inicial. */
  attempts: Attempt[];
  exit: ExitResult | null;
  /** Preenchido pelo repositório: a sessão desta equipe já foi encerrada. */
  sessionClosed?: boolean;
}

export interface Session {
  /** Identificador interno (repositório conectado). */
  id?: string;
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

export type ProjectionStage = 'diagnostico' | 'hipotese' | 'tentativa' | 'saida';

export interface AnonymousExample {
  stage: ProjectionStage;
  major: number;
  minor: number;
  calculation: string;
  answerText: string;
  /** Texto já revisado pelo professor; vazio se a justificativa foi totalmente ocultada. */
  justification: string;
  correct: boolean;
}

export type Projection =
  | { kind: 'none' }
  | { kind: 'distribution'; stage: ProjectionStage; showCorrect: boolean }
  | { kind: 'example'; example: AnonymousExample; showCorrect: boolean };

export interface DistributionEntryView {
  label: string;
  count: number;
  correct: boolean;
}

export interface DistributionView {
  stage: ProjectionStage;
  total: number;
  suppressed: boolean;
  entries: DistributionEntryView[];
  others: number;
}

/**
 * O que a tela de projeção recebe: SOMENTE conteúdo agregado ou exemplo já revisado.
 * Nunca contém apelidos nem identificadores.
 */
export type ProjectionView =
  | { kind: 'none' }
  | { kind: 'distribution'; stage: ProjectionStage; showCorrect: boolean; distribution: DistributionView }
  | { kind: 'example'; example: AnonymousExample; showCorrect: boolean };
