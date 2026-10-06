import { MISSION, STAGES, type StageNumber } from './mission';
import type { TeamRecord } from './types';

/**
 * Etapa da missão em que a equipe está:
 * 1 diagnóstico → 2 hipótese inicial → 3 tentativas e revisões → 4 problema final.
 * A devolutiva da hipótese inicial ainda pertence à etapa 2; a etapa 3 começa quando a equipe
 * volta a explorar para revisar (ou já enviou alguma tentativa).
 */
export function stageOf(team: Pick<TeamRecord, 'phase' | 'hypothesis' | 'attempts'>): StageNumber {
  if (team.phase === 'saida' || team.phase === 'concluido') return 4;
  if (team.phase === 'diagnostico') return 1;
  if (!team.hypothesis) return 2;
  if (team.phase === 'feedback' && team.attempts.length === 0) return 2;
  return 3;
}

export function stageLabel(stage: StageNumber): string {
  return STAGES.find((s) => s.n === stage)!.label;
}

/** Ex.: "Missão 1 — Jardim Geométrico · Etapa 2/4 · Hipótese inicial". */
export function missionStageText(stage: StageNumber): string {
  return `Missão ${MISSION.number} — ${MISSION.name} · Etapa ${stage}/${STAGES.length} · ${stageLabel(stage)}`;
}
