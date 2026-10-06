import { useRepository } from '../../data/context';
import type { Projection, ProjectionStage } from '../../domain/types';

const STAGES: { stage: ProjectionStage; label: string }[] = [
  { stage: 'diagnostico', label: 'Diagnóstico' },
  { stage: 'hipotese', label: 'Hipótese inicial' },
  { stage: 'tentativa', label: '1ª revisão' },
  { stage: 'saida', label: 'Saída' },
];

export function ProjectionControls({ projection, sessionCode }: { projection: Projection; sessionCode?: string }) {
  const repo = useRepository();
  const showCorrect = projection.kind !== 'none' && projection.showCorrect;
  const current =
    projection.kind === 'none' ? 'Nada está sendo projetado.'
    : projection.kind === 'distribution' ? `Projetando a distribuição de respostas (${STAGES.find((s) => s.stage === projection.stage)?.label}).`
    : 'Projetando um exemplo anônimo escolhido por você.';

  return (
    <section className="card" aria-labelledby="proj">
      <h3 id="proj">Modo projeção</h3>
      <p>A tela de projeção mostra <strong>só</strong> a distribuição agregada (com no mínimo 3 equipes; respostas únicas ficam em “outras”) ou um exemplo que você escolheu em “Detalhes” e revisou (ocultando dados pessoais) antes de projetar.</p>
      <p aria-live="polite">{current}</p>
      <div className="actions" role="group" aria-label="Projetar distribuição de respostas">
        {STAGES.map(({ stage, label }) => (
          <button key={stage} type="button" className="btn" onClick={() => repo.setProjection({ kind: 'distribution', stage, showCorrect })}>
            Distribuição: {label}
          </button>
        ))}
        <button type="button" className="btn" onClick={() => repo.setProjection({ kind: 'none' })}>Parar projeção</button>
      </div>
      <label className="check">
        <input type="checkbox" checked={showCorrect} disabled={projection.kind === 'none'}
          onChange={(e) => repo.setProjection({ ...projection, showCorrect: e.target.checked } as Projection)} />
        <span>Mostrar na projeção qual resposta confere</span>
      </label>
      <p><a className="btn" href={sessionCode ? `#/projecao?codigo=${sessionCode}` : '#/projecao'} target="_blank" rel="noopener noreferrer">Abrir tela de projeção (nova janela)</a></p>
    </section>
  );
}
