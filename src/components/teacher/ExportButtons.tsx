import { buildAggregateExport, rowsToCsv } from '../../domain/aggregate';
import { useRepository } from '../../data/context';
import type { TeamRecord } from '../../domain/types';

function download(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportButtons({ teams }: { teams: TeamRecord[] }) {
  const repo = useRepository();
  const build = () => buildAggregateExport(teams, repo.mode === 'demo' ? 'DEMONSTRAÇÃO' : 'CONECTADO');
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <section className="card" aria-labelledby="exp">
      <h3 id="exp">Exportação agregada e anônima</h3>
      <p>Sem apelidos, sem textos livres e sem horários: só contagens e uma linha por equipe com código anônimo (E01, E02…). Equipes fictícias vêm marcadas.</p>
      <div className="actions">
        <button type="button" className="btn" disabled={teams.length === 0} onClick={() => download(`operacao-area-${stamp}.json`, 'application/json', JSON.stringify(build(), null, 2))}>Baixar JSON</button>
        <button type="button" className="btn" disabled={teams.length === 0} onClick={() => download(`operacao-area-${stamp}.csv`, 'text/csv', rowsToCsv(build().linhas))}>Baixar CSV</button>
      </div>
    </section>
  );
}
