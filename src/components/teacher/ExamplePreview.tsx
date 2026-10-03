import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatNumber } from '../../domain/area';
import { aliasWords, applyHidden, initialHidden, PII_LABEL, tokenize } from '../../domain/redact';
import type { AnonymousExample, ProjectionStage, Submission } from '../../domain/types';

export interface PreviewRequest {
  title: string;
  stage: ProjectionStage;
  submission: Submission;
}

interface Props {
  request: PreviewRequest;
  /** Apelidos de todas as equipes da sessão: se aparecerem no texto, são ocultados. */
  aliases: string[];
  onCancel: () => void;
  onConfirm: (example: AnonymousExample) => void;
}

function TokenToggles({ legend, tokens, hidden, onToggle }: {
  legend: string;
  tokens: ReturnType<typeof tokenize>;
  hidden: boolean[];
  onToggle: (index: number) => void;
}) {
  const hasWords = tokens.some((t) => t.isWord);
  return (
    <fieldset className="redact-field">
      <legend>{legend}</legend>
      {!hasWords && <p className="help">Sem texto.</p>}
      <div className="redact-tokens" role="group" aria-label={`${legend}: escolha as palavras a ocultar`}>
        {tokens.map((t, i) =>
          t.isWord ? (
            <button
              key={i}
              type="button"
              className={`redact-token${hidden[i] ? ' is-hidden' : ''}${t.reason ? ' is-flagged' : ''}`}
              aria-pressed={hidden[i]}
              onClick={() => onToggle(i)}
            >
              {t.text}
              {t.reason && <span className="redact-reason"> ({PII_LABEL[t.reason]})</span>}
              <span className="sr-only">{hidden[i] ? ', oculta' : ', visível'}</span>
            </button>
          ) : null,
        )}
      </div>
    </fieldset>
  );
}

/**
 * Revisão obrigatória antes de projetar um exemplo: o professor vê o texto como a turma verá,
 * oculta palavras (sugestões automáticas já vêm marcadas) e confirma.
 */
export function ExamplePreview({ request, aliases, onCancel, onConfirm }: Props) {
  const uid = useId();
  const { submission: s } = request;
  const known = useMemo(() => aliasWords(aliases), [aliases]);
  const calcTokens = useMemo(() => tokenize(s.calculation, known), [s.calculation, known]);
  const whyTokens = useMemo(() => tokenize(s.justification, known), [s.justification, known]);

  const [calcHidden, setCalcHidden] = useState(() => initialHidden(calcTokens));
  const [whyHidden, setWhyHidden] = useState(() => initialHidden(whyTokens));
  const [dropJustification, setDropJustification] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'start' });
  }, []);

  const toggle = (set: React.Dispatch<React.SetStateAction<boolean[]>>) => (i: number) => {
    set((h) => h.map((v, k) => (k === i ? !v : v)));
    setReviewed(false);
  };

  const calculation = applyHidden(calcTokens, calcHidden);
  const justification = dropJustification ? '' : applyHidden(whyTokens, whyHidden);
  const autoCount = [...calcTokens, ...whyTokens].filter((t) => t.reason).length;
  const answerText = `${formatNumber(s.answer)} ${s.unit}`;

  return (
    <section className="card preview" aria-labelledby={`${uid}-t`}>
      <h3 id={`${uid}-t`} ref={heading} tabIndex={-1}>Revisar antes de projetar: {request.title}</h3>
      <p>
        O detector ocultou automaticamente <strong>{autoCount}</strong> trecho(s) que parecem dado pessoal (e-mail, telefone, números longos,
        apelidos de equipe, possíveis nomes). <strong>Ele não encontra tudo</strong>: leia o texto e clique nas palavras para ocultar ou mostrar.
      </p>

      <TokenToggles legend="Cálculo" tokens={calcTokens} hidden={calcHidden} onToggle={toggle(setCalcHidden)} />
      <TokenToggles legend="Justificativa" tokens={whyTokens} hidden={whyHidden} onToggle={toggle(setWhyHidden)} />

      <label className="check">
        <input type="checkbox" checked={dropJustification} onChange={(e) => { setDropJustification(e.target.checked); setReviewed(false); }} />
        <span>Não projetar a justificativa (mostrar só cálculo e resposta)</span>
      </label>

      <div className="preview-box" aria-live="polite">
        <p className="preview-label">Prévia: é exatamente isto que a turma verá</p>
        <p>Losango com D = {formatNumber(s.major)} m e d = {formatNumber(s.minor)} m</p>
        <p>Cálculo: <strong>{calculation || '—'}</strong></p>
        <p>Resposta: <strong>{answerText}</strong></p>
        {justification && <p>Justificativa: “{justification}”</p>}
      </div>

      <label className="check">
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        <span>Revisei o texto: ele não identifica nenhum estudante.</span>
      </label>

      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!reviewed}
          onClick={() =>
            onConfirm({ stage: request.stage, major: s.major, minor: s.minor, calculation, answerText, justification, correct: s.correct })
          }
        >
          Projetar este exemplo
        </button>
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
      </div>
    </section>
  );
}
