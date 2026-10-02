import { useEffect, useId, useState } from 'react';
import { DIAGONAL_STEP, formatNumber, validateDiagonalText } from '../domain/area';

interface Props {
  label: string;
  /** Texto usado nas mensagens ("diagonal maior"). */
  noun: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

/** Slider + campo numérico + botões −/+: três formas equivalentes de ajustar a mesma medida. */
export function DiagonalControl({ label, noun, value, min, max, onChange }: Props) {
  const uid = useId();
  const [draft, setDraft] = useState(formatNumber(value));
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(formatNumber(value));
    setError('');
  }, [value]);

  const commitText = (text: string) => {
    setDraft(text);
    const result = validateDiagonalText(text, min, max, noun);
    if (result.ok) {
      setError('');
      if (result.value !== value) onChange(result.value);
    } else {
      setError(result.message);
    }
  };
  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, Math.round((value + delta) / DIAGONAL_STEP) * DIAGONAL_STEP));
    if (next !== value) onChange(next);
  };

  return (
    <div className="diag-control">
      <label htmlFor={`${uid}-num`} className="diag-label">{label}</label>
      <div className="diag-row">
        <button type="button" className="btn btn-icon" onClick={() => step(-DIAGONAL_STEP)} disabled={value <= min}
          aria-label={`Diminuir ${noun} em ${formatNumber(DIAGONAL_STEP)} metro`}>−</button>
        <input
          id={`${uid}-num`}
          className="input input-number"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft}
          onChange={(e) => commitText(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${uid}-err` : `${uid}-unit`}
        />
        <span id={`${uid}-unit`} className="unit">m</span>
        <button type="button" className="btn btn-icon" onClick={() => step(DIAGONAL_STEP)} disabled={value >= max}
          aria-label={`Aumentar ${noun} em ${formatNumber(DIAGONAL_STEP)} metro`}>+</button>
      </div>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={DIAGONAL_STEP}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} (controle deslizante)`}
        aria-valuetext={`${formatNumber(value)} metros`}
      />
      <p id={`${uid}-err`} className="field-error" role="alert">{error}</p>
    </div>
  );
}
