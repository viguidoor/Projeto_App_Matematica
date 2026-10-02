import type { Diagonals, HintLevel } from './types';

/** Questão diagnóstica (antes de qualquer dica). Área esperada: 20 m². */
export const DIAGNOSTIC_PROBLEM = {
  title: 'Questão diagnóstica',
  context:
    'O refeitório vai receber um painel decorativo em forma de losango. As diagonais do painel medem 8 m e 5 m.',
  question: 'Qual é a área do painel?',
  measures: { major: 8, minor: 5 } satisfies Diagonals,
};

/** Medidas iniciais do jardim na exploração (o professor pode alterá-las ao ensaiar). */
export const EXPLORATION_START: Diagonals = { major: 10, minor: 6 };

/** Problema de saída equivalente, com outras medidas. Área esperada: 24 m². */
export const EXIT_PROBLEM = {
  title: 'Problema final',
  context: 'A horta do pátio terá um canteiro em forma de losango. As diagonais do canteiro medem 12 m e 4 m.',
  question: 'Qual é a área do canteiro?',
  measures: { major: 12, minor: 4 } satisfies Diagonals,
};

export interface Hint {
  level: HintLevel;
  title: string;
  text: string;
}

/**
 * Dicas progressivas. Nenhuma contém algarismos, fórmula pronta ou resultado:
 * o teste de dicas garante isso.
 */
export const HINTS: readonly Hint[] = [
  {
    level: 1,
    title: 'Dica 1: identifiquem as diagonais',
    text:
      'As diagonais ligam vértices opostos do losango e se cruzam no centro. A maior é D e a menor é d. ' +
      'Conferam se as medidas usadas no cálculo são mesmo as das diagonais.',
  },
  {
    level: 2,
    title: 'Dica 2: pensem em um retângulo',
    text:
      'Imaginem um retângulo que envolve o losango, com lados iguais a D e a d. ' +
      'Cada vértice do losango toca o meio de um lado desse retângulo (veja a figura).',
  },
  {
    level: 3,
    title: 'Dica 3: comparem as áreas',
    text:
      'Dentro do retângulo, o losango ocupa uma parte e sobram quatro triângulos nos cantos (veja a figura). ' +
      'Comparem a área do losango com a do retângulo e reescrevam o cálculo explicando cada passo.',
  },
];

export const NARRATIVE =
  'A reforma da nossa escola está bloqueada. Cada missão libera um ambiente depois que a equipe investiga as medidas e apresenta uma solução bem justificada. A primeira missão é o jardim.';

export const GARDEN_CONTEXT =
  'O jardim da escola será refeito em forma de losango. Ajustem as diagonais, investiguem e depois proponham a área.';
