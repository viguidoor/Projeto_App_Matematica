import { useId, useRef, useState, type FormEvent } from 'react';
import { RepositoryError } from '../data/repository';
import { LIMITS, validateSubmissionInput, type FieldErrors } from '../domain/evaluate';
import type { SubmissionInput, Unit } from '../domain/types';

interface Props {
  legend: string;
  submitLabel: string;
  calculationHelp?: string;
  onSubmit: (input: SubmissionInput) => Promise<void>;
}

function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e12).toString(36)}`;
}

type FieldKey = 'calculation' | 'rawAnswer' | 'unit' | 'justification';
const ORDER: FieldKey[] = ['calculation', 'rawAnswer', 'unit', 'justification'];

export function AnswerForm({ legend, submitLabel, calculationHelp = 'Escrevam as contas como fariam no caderno.', onSubmit }: Props) {
  const uid = useId();
  // Mesmo identificador em reenvios do mesmo formulário: repetir o envio não duplica o registro.
  const requestId = useRef(newRequestId());
  const [values, setValues] = useState<SubmissionInput>({ calculation: '', rawAnswer: '', unit: '', justification: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const refs = {
    calculation: useRef<HTMLInputElement>(null),
    rawAnswer: useRef<HTMLInputElement>(null),
    unit: useRef<HTMLInputElement>(null),
    justification: useRef<HTMLTextAreaElement>(null),
  };

  const set = <K extends FieldKey>(key: K, value: SubmissionInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    const check = validateSubmissionInput(values);
    if (!check.ok) {
      setErrors(check.errors);
      const first = ORDER.find((k) => check.errors[k]);
      if (first) refs[first].current?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit({ ...values, requestId: requestId.current });
    } catch (err) {
      setServerError(err instanceof RepositoryError ? err.message : 'Não foi possível enviar. Tentem de novo.');
      setBusy(false);
    }
  };

  const err = (k: FieldKey) => (errors[k] ? `${uid}-${k}-err` : undefined);

  return (
    <form className="answer-form" onSubmit={submit} noValidate aria-label={legend}>
      <h3 className="form-title">{legend}</h3>

      <div className="field">
        <label htmlFor={`${uid}-calc`}>Cálculo da equipe</label>
        <p className="help" id={`${uid}-calc-help`}>{calculationHelp}</p>
        <input id={`${uid}-calc`} ref={refs.calculation} className="input" type="text" autoComplete="off" maxLength={LIMITS.calculationMax}
          value={values.calculation} onChange={(e) => set('calculation', e.target.value)}
          aria-invalid={errors.calculation ? true : undefined}
          aria-describedby={[`${uid}-calc-help`, err('calculation')].filter(Boolean).join(' ')} />
        <p id={`${uid}-calculation-err`} className="field-error" role="alert">{errors.calculation ?? ''}</p>
      </div>

      <div className="field-pair">
        <div className="field">
          <label htmlFor={`${uid}-ans`}>Área encontrada (número)</label>
          <input id={`${uid}-ans`} ref={refs.rawAnswer} className="input" type="text" inputMode="decimal" autoComplete="off"
            value={values.rawAnswer} onChange={(e) => set('rawAnswer', e.target.value)}
            aria-invalid={errors.rawAnswer ? true : undefined} aria-describedby={err('rawAnswer')} />
          <p id={`${uid}-rawAnswer-err`} className="field-error" role="alert">{errors.rawAnswer ?? ''}</p>
        </div>

        <fieldset className="field unit-field" aria-describedby={err('unit')}>
          <legend>Unidade da resposta</legend>
          <div className="radio-row">
            {(['m', 'm²'] as Unit[]).map((u, i) => (
              <label key={u} className="radio">
                <input type="radio" name={`${uid}-unit`} value={u} checked={values.unit === u}
                  ref={i === 0 ? refs.unit : undefined} onChange={() => set('unit', u)} />
                <span>{u === 'm' ? 'm (metro)' : 'm² (metro quadrado)'}</span>
              </label>
            ))}
          </div>
          <p id={`${uid}-unit-err`} className="field-error" role="alert">{errors.unit ?? ''}</p>
        </fieldset>
      </div>

      <div className="field">
        <label htmlFor={`${uid}-just`}>Justificativa: como a equipe pensou?</label>
        <textarea id={`${uid}-just`} ref={refs.justification} className="input textarea" rows={3} maxLength={LIMITS.justificationMax}
          value={values.justification} onChange={(e) => set('justification', e.target.value)}
          aria-invalid={errors.justification ? true : undefined} aria-describedby={err('justification')} />
        <p id={`${uid}-justification-err`} className="field-error" role="alert">{errors.justification ?? ''}</p>
      </div>

      <p className="field-error" role="alert">{serverError}</p>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Enviando…' : submitLabel}</button>
    </form>
  );
}
