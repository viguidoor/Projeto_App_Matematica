import { DemoRepository } from '../src/data/demoRepository';
import { MemoryStore } from '../src/data/kvStore';
import type { SubmissionInput, TeamRecord } from '../src/domain/types';

/** Repositório de teste: memória, relógio que avança 1 s a cada leitura e aleatório determinístico. */
export function makeRepo() {
  let t = 1_700_000_000_000;
  let r = 0.12345;
  const store = new MemoryStore();
  const repo = new DemoRepository(store, {
    now: () => (t += 1000),
    random: () => ((r = (r * 9301 + 0.49297) % 1), r),
  });
  return { repo, store };
}

export const input = (rawAnswer: string, unit: 'm' | 'm²' | '' = 'm²', extra: Partial<SubmissionInput> = {}): SubmissionInput => ({
  calculation: '10 × 6 ÷ 2',
  rawAnswer,
  unit,
  justification: 'Multiplicamos as diagonais e dividimos.',
  ...extra,
});

export async function joined(alias = 'Equipe Teste'): Promise<{ repo: ReturnType<typeof makeRepo>['repo']; team: TeamRecord; code: string }> {
  const { repo } = makeRepo();
  const session = await repo.openSession();
  const team = await repo.joinSession(session.code, alias);
  return { repo, team, code: session.code };
}

/** Leva a equipe até a fase de hipótese (diagnóstico enviado e fase `hipotese`). */
export async function toHypothesis(repo: ReturnType<typeof makeRepo>['repo'], teamId: string, diagnostic = '20') {
  await repo.submitDiagnostic(teamId, input(diagnostic));
  await repo.saveProgress(teamId, { phase: 'hipotese' });
}

/** Leva a equipe até a devolutiva da hipótese inicial (diagnóstico, exploração e hipótese enviada). */
export async function withHypothesis(repo: ReturnType<typeof makeRepo>['repo'], teamId: string, answer = '60', diagnostic = '20') {
  await toHypothesis(repo, teamId, diagnostic);
  await repo.submitHypothesis(teamId, input(answer));
}

/** Faz uma revisão (volta à exploração, abre o formulário e envia uma tentativa). */
export async function revise(repo: ReturnType<typeof makeRepo>['repo'], teamId: string, answer: string) {
  await repo.saveProgress(teamId, { phase: 'exploracao' });
  await repo.saveProgress(teamId, { phase: 'hipotese' });
  return repo.submitAttempt(teamId, input(answer));
}
