import { useId, useState, type FormEvent } from 'react';
import { ScreenHeading } from '../ScreenHeading';
import { useRepository } from '../../data/context';
import { RepositoryError } from '../../data/repository';
import { NARRATIVE } from '../../domain/mission';
import type { TeamRecord } from '../../domain/types';

export function Intro({ onStart }: { onStart: () => void }) {
  return (
    <section aria-labelledby="intro-title">
      <ScreenHeading>Operação Área: Reconstruindo Nossa Escola</ScreenHeading>
      <p id="intro-title" className="lead">{NARRATIVE}</p>
      <p>Vocês vão trabalhar em equipe, com um apelido de equipe. Não precisam informar nomes. Não há cronômetro nem ranking.</p>
      <button type="button" className="btn btn-primary" onClick={onStart}>Começar</button>
    </section>
  );
}

const SUGGESTIONS = ['Girassol', 'Ipê', 'Jacarandá', 'Araucária', 'Cerrado', 'Mandacaru'];

export function Join({ onJoined }: { onJoined: (team: TeamRecord) => void }) {
  const repo = useRepository();
  const uid = useId();
  const [code, setCode] = useState('');
  const [alias, setAlias] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!code.trim()) return setError('Digitem o código da sessão mostrado pelo professor.');
    if (!alias.trim()) return setError('Escolham um apelido para a equipe.');
    setBusy(true);
    try {
      onJoined(await repo.joinSession(code, alias));
    } catch (err) {
      setError(err instanceof RepositoryError ? err.message : 'Não foi possível entrar. Tentem de novo.');
      setBusy(false);
    }
  };

  return (
    <section>
      <ScreenHeading>Entrar na sessão</ScreenHeading>
      <form onSubmit={submit} noValidate aria-label="Entrada da equipe" className="answer-form">
        <div className="field">
          <label htmlFor={`${uid}-code`}>Código da sessão</label>
          <input id={`${uid}-code`} className="input input-code" type="text" autoComplete="off" autoCapitalize="characters"
            maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-alias`}>Apelido da equipe</label>
          <p className="help" id={`${uid}-alias-help`}>Inventem um apelido. Não usem nome completo, telefone ou outros dados pessoais.</p>
          <input id={`${uid}-alias`} className="input" type="text" autoComplete="off" maxLength={24}
            value={alias} onChange={(e) => setAlias(e.target.value)} aria-describedby={`${uid}-alias-help`} />
          <div className="chips" role="group" aria-label="Sugestões de apelido">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => setAlias(`Equipe ${s}`)}>Equipe {s}</button>
            ))}
          </div>
        </div>
        <p className="field-error" role="alert">{error}</p>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </section>
  );
}
