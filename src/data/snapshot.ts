import { useLiveData } from './context';
import type { Projection, Session, TeacherNote, TeamRecord } from '../domain/types';

export interface Snapshot {
  session: Session | null;
  teams: TeamRecord[];
  notes: TeacherNote[];
  projection: Projection;
}

export const EMPTY_SNAPSHOT: Snapshot = { session: null, teams: [], notes: [], projection: { kind: 'none' } };

/** Visão atualizada da sessão corrente, para o painel do professor e para a projeção. */
export function useSnapshot(): Snapshot {
  return useLiveData(async (repo) => {
    const session = await repo.getCurrentSession();
    return {
      session,
      teams: session ? await repo.listTeams(session.code) : [],
      notes: session ? await repo.listNotes(session.code) : [],
      projection: await repo.getProjection(),
    };
  }, EMPTY_SNAPSHOT);
}
