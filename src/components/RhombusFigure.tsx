import { useId, useRef } from 'react';
import { DIAGONAL_STEP, MAX_DIAGONAL, MIN_DIAGONAL, formatNumber } from '../domain/area';
import type { Diagonals } from '../domain/types';

const SCALE = 18; // px por metro (escala fixa: a figura realmente muda ao ajustar as diagonais)
const SIZE = 400;
const C = SIZE / 2;

interface Props extends Diagonals {
  /** Dicas 2 e 3 acrescentam elementos à figura (sem mostrar a área). */
  showRectangle?: boolean;
  showTriangles?: boolean;
  /** Se informado, os vértices direito e superior podem ser arrastados (além dos controles numéricos). */
  onChange?: (next: Diagonals) => void;
  label?: string;
}

const snap = (v: number) => Math.round(v / DIAGONAL_STEP) * DIAGONAL_STEP;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function RhombusFigure({ major, minor, showRectangle, showTriangles, onChange, label = 'Jardim em forma de losango' }: Props) {
  const uid = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<'major' | 'minor' | null>(null);

  const hw = (major * SCALE) / 2;
  const hh = (minor * SCALE) / 2;
  const L = [C - hw, C], T = [C, C - hh], R = [C + hw, C], B = [C, C + hh];
  const pts = (...p: number[][]) => p.map((q) => q.join(',')).join(' ');

  const description =
    `${label}. Diagonal maior D: ${formatNumber(major)} metros (horizontal). Diagonal menor d: ${formatNumber(minor)} metros (vertical).` +
    (showRectangle ? ' Um retângulo tracejado envolve o losango, com lados iguais às diagonais.' : '') +
    (showTriangles ? ' Os quatro triângulos dos cantos, entre o retângulo e o losango, estão hachurados.' : '');

  const move = (e: React.PointerEvent) => {
    if (!dragging.current || !onChange || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = ((e.clientX - rect.left) * SIZE) / rect.width;
    const y = ((e.clientY - rect.top) * (SIZE + 60)) / rect.height - 30;
    if (dragging.current === 'major') {
      onChange({ major: clamp(snap((2 * Math.abs(x - C)) / SCALE), Math.max(MIN_DIAGONAL, minor), MAX_DIAGONAL), minor });
    } else {
      onChange({ major, minor: clamp(snap((2 * Math.abs(y - C)) / SCALE), MIN_DIAGONAL, major) });
    }
  };
  const start = (which: 'major' | 'minor') => (e: React.PointerEvent<SVGCircleElement>) => {
    dragging.current = which;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const stop = () => {
    dragging.current = null;
  };

  return (
    <svg
      ref={svgRef}
      className="figure"
      viewBox={`0 -30 ${SIZE} ${SIZE + 60}`}
      role="img"
      aria-labelledby={`${uid}-t`}
      aria-describedby={`${uid}-d`}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <title id={`${uid}-t`}>{label}</title>
      <desc id={`${uid}-d`}>{description}</desc>
      <defs>
        <pattern id={`${uid}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#fff" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="#7a3e00" strokeWidth="3" />
        </pattern>
      </defs>

      {showRectangle && (
        <rect x={L[0]} y={T[1]} width={2 * hw} height={2 * hh} fill="none" stroke="#7a3e00" strokeWidth="3" strokeDasharray="10 6" />
      )}
      {showTriangles && (
        <g fill={`url(#${uid}-hatch)`} stroke="#7a3e00" strokeWidth="1.5">
          <polygon points={pts([L[0], T[1]], L, T)} />
          <polygon points={pts([R[0], T[1]], T, R)} />
          <polygon points={pts([R[0], B[1]], R, B)} />
          <polygon points={pts([L[0], B[1]], B, L)} />
        </g>
      )}

      <polygon points={pts(L, T, R, B)} fill="#bfe3c0" stroke="#1b5e20" strokeWidth="4" strokeLinejoin="round" />
      <line x1={L[0]} y1={C} x2={R[0]} y2={C} stroke="#0b2a4a" strokeWidth="3" strokeDasharray="6 4" />
      <line x1={C} y1={T[1]} x2={C} y2={B[1]} stroke="#0b2a4a" strokeWidth="3" strokeDasharray="6 4" />

      <text x={C} y={B[1] + 36} textAnchor="middle" className="fig-label">D = {formatNumber(major)} m (diagonal maior)</text>
      <text x={C} y={T[1] - 26} textAnchor="middle" className="fig-label">d = {formatNumber(minor)} m (diagonal menor)</text>

      {onChange && (
        <g className="handles" aria-hidden="true">
          <circle cx={R[0]} cy={C} r="16" onPointerDown={start('major')} />
          <circle cx={C} cy={T[1]} r="16" onPointerDown={start('minor')} />
        </g>
      )}
    </svg>
  );
}
