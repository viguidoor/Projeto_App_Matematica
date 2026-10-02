import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SessionRepository } from './repository';

const RepositoryContext = createContext<SessionRepository | null>(null);

export function RepositoryProvider({ repository, children }: { repository: SessionRepository; children: ReactNode }) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): SessionRepository {
  const repo = useContext(RepositoryContext);
  if (!repo) throw new Error('RepositoryProvider ausente.');
  return repo;
}

/** Executa `load` agora e a cada mudança de dados (outra aba do mesmo navegador, em DEMONSTRAÇÃO). */
export function useLiveData<T>(load: (repo: SessionRepository) => Promise<T>, initial: T): T {
  const repo = useRepository();
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let alive = true;
    const run = () => {
      load(repo).then((v) => alive && setValue(v));
    };
    run();
    const off = repo.subscribe(run);
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);
  return value;
}
