import { describe, expect, it } from 'vitest';
import { buildAggregateExport, buildDistribution, rowsToCsv } from '../src/domain/aggregate';
import { input, makeRepo, revise, toHypothesis } from './helpers';

async function classroom() {
  const { repo } = makeRepo();
  const { code } = await repo.openSession();
  const specs = [
    { alias: 'Equipe Alfa', diag: '20', hyp: '60', hints: 0, revision: '', exit: '24' },
    { alias: 'Equipe Beta', diag: '40', hyp: '60', hints: 2, revision: '30', exit: '24' },
    { alias: 'Equipe Gama', diag: '40', hyp: '30', hints: 1, revision: '', exit: '48' },
    { alias: 'Equipe Delta', diag: '13', hyp: '30', hints: 0, revision: '', exit: '24' },
  ];
  for (const s of specs) {
    const team = await repo.joinSession(code, s.alias);
    await toHypothesis(repo, team.id, s.diag);
    await repo.submitHypothesis(team.id, input(s.hyp));
    for (let l = 1; l <= s.hints; l += 1) await repo.recordHint(team.id, l as 1 | 2); // dicas só depois da hipótese inicial
    if (s.revision) await revise(repo, team.id, s.revision);
    await repo.saveProgress(team.id, { phase: 'saida' });
    await repo.submitExit(team.id, input(s.exit));
  }
  return { repo, code, teams: await repo.listTeams(code) };
}

describe('distribuição agregada (projeção)', () => {
  it('agrupa respostas iguais e junta as únicas em "outras", sem apelidos', async () => {
    const { teams } = await classroom();
    const d = buildDistribution(teams, 'diagnostico');
    expect(d.suppressed).toBe(false);
    expect(d.total).toBe(4);
    expect(d.entries).toEqual([{ label: '40 m²', count: 2, correct: false }]);
    expect(d.others).toBe(2);
    expect(JSON.stringify(d)).not.toMatch(/Equipe|Alfa|Beta/);
  });
  it('não exibe distribuição com menos de 3 respostas', async () => {
    const { teams } = await classroom();
    const d = buildDistribution(teams.slice(0, 2), 'saida');
    expect(d.suppressed).toBe(true);
    expect(d.entries).toEqual([]);
  });
  it('hipótese inicial, primeira revisão e saída são etapas separadas', async () => {
    const { teams } = await classroom();
    expect(buildDistribution(teams, 'hipotese').entries.map((e) => e.label)).toEqual(['30 m²', '60 m²']);
    expect(buildDistribution(teams, 'saida').entries.map((e) => e.label)).toEqual(['24 m²']);
    const revisions = buildDistribution(teams, 'tentativa');
    expect(revisions.total).toBe(1); // só a equipe Beta revisou
    expect(revisions.suppressed).toBe(true);
  });
  it('o grupo só "confere" se todas as respostas dele conferem', async () => {
    const { repo, code } = await classroom();
    const x = await repo.joinSession(code, 'Equipe Extra');
    await repo.submitDiagnostic(x.id, input('20'));
    await repo.saveProgress(x.id, { diagonals: { major: 12, minor: 6 } }); // área correta aqui: 36 m²
    await repo.saveProgress(x.id, { phase: 'hipotese' });
    await repo.submitHypothesis(x.id, input('30')); // "30 m²" também aparece em equipes com 10 × 6, onde confere
    const d = buildDistribution(await repo.listTeams(code), 'hipotese');
    expect(d.total).toBe(5);
    const g = d.entries.find((e) => e.label === '30 m²')!;
    expect(g.count).toBe(3);
    expect(g.correct).toBe(false);
  });
});

describe('exportação agregada e anônima', () => {
  it('não contém apelidos, identificadores, textos livres nem horários', async () => {
    const { teams } = await classroom();
    const data = buildAggregateExport(teams, 'DEMONSTRAÇÃO', new Date('2026-10-02T12:00:00Z'));
    const text = JSON.stringify(data) + rowsToCsv(data.linhas);
    for (const t of teams) {
      expect(text).not.toContain(t.alias);
      expect(text).not.toContain(t.id);
    }
    expect(text).not.toContain('Multiplicamos');
    expect(text).not.toMatch(/submittedAt|joinedAt|justif/i);
    expect(data.linhas.map((l) => l.equipe_anonima)).toEqual(['E01', 'E02', 'E03', 'E04']);
    expect(data.modo).toBe('DEMONSTRAÇÃO');
    expect(data.avisoLimites).toMatch(/não permite atribuir/);
  });
  it('resume diagnóstico → hipótese inicial → revisões → saída, com dicas por separado', async () => {
    const { teams } = await classroom();
    const r = buildAggregateExport(teams, 'DEMONSTRAÇÃO').resumo;
    expect(r.diagnostico).toEqual({ respondidas: 4, corretas: 1 });
    expect(r.hipoteseInicial).toEqual({ respondidas: 4, corretas: 2 });
    expect(r.saida).toEqual({ respondidas: 4, corretas: 3 });
    expect(r.diagnosticoParaSaida).toEqual({ ambasCorretas: 1, diagnosticoErradoSaidaCerta: 2, diagnosticoCertoSaidaErrada: 0, ambasErradas: 1 });
    expect(r.tentativas.total).toBe(1);
    expect(r.tentativas.equipesComDicas).toBe(2);
    expect(r.tentativas.dicasPorNivel).toEqual({ '1': 2, '2': 1, '3': 0 });
    expect(r.trajetorias).toEqual({
      'diag=certo;hip=errado;rev=0;saida=certo': 1,
      'diag=errado;hip=errado;rev=1;saida=certo': 1,
      'diag=errado;hip=certo;rev=0;saida=errado': 1,
      'diag=errado;hip=certo;rev=0;saida=certo': 1,
    });
  });
  it('as linhas separam hipótese inicial e revisões', async () => {
    const { teams } = await classroom();
    const rows = buildAggregateExport(teams, 'DEMONSTRAÇÃO').linhas;
    expect(rows.filter((l) => l.hipotese_correta === 'sim')).toHaveLength(2);
    expect(rows.filter((l) => l.revisoes === 1)).toHaveLength(1);
    expect(rows.find((l) => l.revisoes === 1)).toMatchObject({ acertou_apos_revisao: 'sim', revisoes_com_dicas: 1, dica_maxima: 2 });
  });
  it('gera CSV com cabeçalho e uma linha por equipe', async () => {
    const { teams } = await classroom();
    const csv = rowsToCsv(buildAggregateExport(teams, 'DEMONSTRAÇÃO').linhas).trim().split('\n');
    expect(csv).toHaveLength(5);
    expect(csv[0]).toContain('equipe_anonima');
    expect(csv[0]).toContain('hipotese_correta');
    expect(csv[0]).toContain('saida_correta');
  });
});
