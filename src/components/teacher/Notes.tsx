import { useId, useState, type FormEvent } from 'react';
import { useRepository } from '../../data/context';
import type { Session, TeacherNote, TeamRecord } from '../../domain/types';

export function Notes({ session, teams, notes }: { session: Session | null; teams: TeamRecord[]; notes: TeacherNote[] }) {
  const repo = useRepository();
  const uid = useId();
  const [team, setTeam] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [intervention, setIntervention] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return setError('Abra uma sessão para registrar notas.');
    setError('');
    try {
      await repo.addNote(session.code, { team: team || null, difficulty, intervention, response });
      setDifficulty(''); setIntervention(''); setResponse('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    }
  };

  return (
    <section className="card" aria-labelledby="notas">
      <h3 id="notas">Notas do professor: dificuldade → intervenção → resposta após a mediação</h3>
      <form onSubmit={submit} noValidate aria-label="Nova nota">
        <div className="field">
          <label htmlFor={`${uid}-team`}>Equipe</label>
          <select id={`${uid}-team`} className="input" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Turma toda</option>
            {teams.map((t) => <option key={t.id} value={t.alias}>{t.alias}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor={`${uid}-d`}>Dificuldade observada</label>
          <textarea id={`${uid}-d`} className="input textarea" rows={2} value={difficulty} onChange={(e) => setDifficulty(e.target.value)} /></div>
        <div className="field"><label htmlFor={`${uid}-i`}>Pergunta ou intervenção</label>
          <textarea id={`${uid}-i`} className="input textarea" rows={2} value={intervention} onChange={(e) => setIntervention(e.target.value)} /></div>
        <div className="field"><label htmlFor={`${uid}-r`}>Resposta após a mediação</label>
          <textarea id={`${uid}-r`} className="input textarea" rows={2} value={response} onChange={(e) => setResponse(e.target.value)} /></div>
        <p className="field-error" role="alert">{error}</p>
        <button type="submit" className="btn">Salvar nota</button>
      </form>
      {notes.length > 0 && (
        <ol className="notes">
          {notes.map((n) => (
            <li key={n.id}>
              <strong>{n.team ?? 'Turma toda'}</strong> · {new Date(n.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              <br />Dificuldade: {n.difficulty || '—'}<br />Intervenção: {n.intervention || '—'}<br />Depois da mediação: {n.response || '—'}
            </li>
          ))}
        </ol>
      )}
      <p className="help">As notas ficam só no painel e não entram na exportação (podem citar equipes).</p>
    </section>
  );
}
