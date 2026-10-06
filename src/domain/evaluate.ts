import { formatNumber, MAX_ANSWER, parseDecimal, rhombusArea, sameNumber } from './area';
import { containsPersonalData, PERSONAL_DATA_MESSAGE } from './pii';
import type { PatternId, SubmissionInput, Unit } from './types';

export interface PatternInfo {
  id: PatternId;
  /** Texto para o professor — sempre uma HIPÓTESE pedagógica, nunca diagnóstico. */
  teacherHypothesis: string;
  /** Pergunta de mediação sugerida ao professor. */
  teacherQuestion: string;
  /** Devolutiva para a equipe: descreve o que foi feito, sem revelar a resposta. */
  studentFeedback: string;
}

export const PATTERNS: Record<PatternId, PatternInfo> = {
  produto_sem_metade: {
    id: 'produto_sem_metade',
    teacherHypothesis: 'O valor coincide com o produto das diagonais: possível omissão da divisão por 2.',
    teacherQuestion: 'Como relacionar o losango ao retângulo que o envolve? Quantas vezes o losango "cabe" nele?',
    studentFeedback:
      'Vocês multiplicaram as duas diagonais. Esse produto é a área do losango ou de outra figura ligada a ele? Pensem no retângulo que o envolve.',
  },
  soma_diagonais: {
    id: 'soma_diagonais',
    teacherHypothesis:
      'O valor coincide com a soma das diagonais: possível confusão entre comprimento e área (ou entre perímetro e área).',
    teacherQuestion: 'Somar medidas em metros resulta em quê? Que operação combina duas medidas para formar uma superfície?',
    studentFeedback:
      'Vocês somaram as diagonais. Somar medidas dá um comprimento, em metros; a área é medida em metros quadrados. Que operação combina duas medidas para cobrir uma superfície?',
  },
  media_diagonais: {
    id: 'media_diagonais',
    teacherHypothesis: 'O valor coincide com a média das diagonais: possível uso da ideia de média no lugar de uma relação de área.',
    teacherQuestion: 'A média das diagonais é um comprimento ou uma área? Como as duas diagonais se combinam para medir a superfície?',
    studentFeedback:
      'Esse valor é a média das diagonais, que continua sendo um comprimento. Como as duas diagonais se combinam para medir uma superfície?',
  },
  quarto_do_produto: {
    id: 'quarto_do_produto',
    teacherHypothesis:
      'O valor coincide com o produto das diagonais dividido por 4: possível divisão por 2 aplicada duas vezes ou leitura apenas dos triângulos internos.',
    teacherQuestion: 'O que cada divisão do cálculo representa na figura? Quantos triângulos formam o losango?',
    studentFeedback: 'Parece que o cálculo teve divisões a mais. Expliquem o que cada divisão representa na figura.',
  },
  unidade_incorreta: {
    id: 'unidade_incorreta',
    teacherHypothesis: 'O número está de acordo com o esperado, mas a unidade escolhida não é de área: possível dificuldade com unidades.',
    teacherQuestion: 'Que unidade mede superfícies? Por que o metro sozinho não serve para uma área?',
    studentFeedback: 'O número está de acordo com o esperado, mas a unidade da resposta não é a de área. Que unidade mede superfícies?',
  },
};

export const GENERIC_FEEDBACK =
  'Ainda não confere. Revisem as medidas usadas e expliquem cada passo do cálculo. Vocês podem pedir uma dica ou conversar com o professor antes de tentar de novo.';

export interface Evaluation {
  correct: boolean;
  patternId: PatternId | null;
}

export function evaluateAnswer(major: number, minor: number, answer: number, unit: Unit): Evaluation {
  const area = rhombusArea(major, minor);
  if (sameNumber(answer, area)) {
    return unit === 'm²' ? { correct: true, patternId: null } : { correct: false, patternId: 'unidade_incorreta' };
  }
  // Se mais de um padrão coincide (ocorre com medidas pequenas ou iguais), não rotula: evita afirmar demais.
  const matches: PatternId[] = [];
  if (sameNumber(answer, major * minor)) matches.push('produto_sem_metade');
  if (sameNumber(answer, major + minor)) matches.push('soma_diagonais');
  if (sameNumber(answer, (major + minor) / 2)) matches.push('media_diagonais');
  if (sameNumber(answer, (major * minor) / 4)) matches.push('quarto_do_produto');
  return { correct: false, patternId: matches.length === 1 ? matches[0] : null };
}

export type FieldErrors = Partial<Record<keyof SubmissionInput, string>>;
export type SubmissionCheck =
  | { ok: true; value: { calculation: string; answer: number; unit: Unit; justification: string; rawAnswer: string } }
  | { ok: false; errors: FieldErrors };

export const LIMITS = { calculationMin: 3, calculationMax: 120, justificationMin: 2, justificationMax: 500 };

export function validateSubmissionInput(input: SubmissionInput): SubmissionCheck {
  const errors: FieldErrors = {};
  const calculation = input.calculation.trim();
  const justification = input.justification.trim();

  if (calculation.length < LIMITS.calculationMin) errors.calculation = 'Registrem o cálculo da equipe (ex.: 3 × 4).';
  else if (calculation.length > LIMITS.calculationMax) errors.calculation = `O cálculo pode ter até ${LIMITS.calculationMax} caracteres.`;
  else if (containsPersonalData(calculation)) errors.calculation = PERSONAL_DATA_MESSAGE;

  const parsed = parseDecimal(input.rawAnswer);
  let answer = 0;
  if (!parsed.ok) errors.rawAnswer = parsed.message;
  else if (parsed.value <= 0) errors.rawAnswer = 'A área deve ser maior que zero.';
  else if (parsed.value > MAX_ANSWER) errors.rawAnswer = `Digite um valor de até ${formatNumber(MAX_ANSWER)}.`;
  else answer = parsed.value;

  if (input.unit !== 'm' && input.unit !== 'm²') errors.unit = 'Escolham a unidade da resposta.';

  if (justification.length < LIMITS.justificationMin) {
    errors.justification = 'Escrevam como pensaram. Pode ser curto, por exemplo: "metade do retângulo".';
  } else if (justification.length > LIMITS.justificationMax) {
    errors.justification = `A justificativa pode ter até ${LIMITS.justificationMax} caracteres.`;
  } else if (containsPersonalData(justification)) {
    errors.justification = PERSONAL_DATA_MESSAGE;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { calculation, answer, unit: input.unit as Unit, justification, rawAnswer: input.rawAnswer.trim() },
  };
}
