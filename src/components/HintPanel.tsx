import { useState } from 'react';
import { RepositoryError } from '../data/repository';
import { HINTS } from '../domain/mission';
import { maxHintLevel } from '../domain/status';
import type { HintLevel, TeamRecord } from '../domain/types';

export function HintPanel({ team, onHint }: { team: TeamRecord; onHint: (level: HintLevel) => Promise<void> }) {
  const level = maxHintLevel(team);
  const [error, setError] = useState('');
  const next = HINTS.find((h) => h.level === level + 1);

  const ask = async () => {
    if (!next) return;
    setError('');
    try {
      await onHint(next.level);
    } catch (e) {
      setError(e instanceof RepositoryError ? e.message : 'Não foi possível abrir a dica.');
    }
  };

  return (
    <section className="hints" aria-labelledby="hints-title">
      <h3 id="hints-title">Dicas</h3>
      <p className="help">Pedir dica não tem penalidade. Ajuda o professor a saber onde apoiar. As dicas não dão a resposta.</p>
      <div aria-live="polite">
        {HINTS.filter((h) => h.level <= level).map((h) => (
          <article key={h.level} className="hint">
            <h4>{h.title}</h4>
            <p>{h.text}</p>
          </article>
        ))}
      </div>
      {next ? (
        <button type="button" className="btn" onClick={ask}>Pedir a dica {next.level} de {HINTS.length}</button>
      ) : (
        <p className="help">Todas as dicas já foram abertas. Conversem com o professor se precisarem.</p>
      )}
      <p className="field-error" role="alert">{error}</p>
    </section>
  );
}
