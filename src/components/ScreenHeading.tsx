import { useEffect, useRef, type ReactNode } from 'react';

/** Título de tela que recebe o foco ao aparecer (leitores de tela anunciam a nova etapa). */
export function ScreenHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h2 ref={ref} tabIndex={-1} className="screen-title">
      {children}
    </h2>
  );
}
