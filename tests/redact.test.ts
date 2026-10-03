import { describe, expect, it } from 'vitest';
import { aliasWords, applyHidden, HIDDEN_MARK, initialHidden, tokenize } from '../src/domain/redact';

const redact = (text: string, aliases: string[] = []) => {
  const tokens = tokenize(text, aliasWords(aliases));
  return applyHidden(tokens, initialHidden(tokens));
};

describe('detecção sugerida de dados pessoais', () => {
  it('oculta e-mail, telefone, endereço web e números longos', () => {
    expect(redact('escreva para ana@escola.com')).toBe(`escreva para ${HIDDEN_MARK}`);
    expect(redact('zap 99999-1234 ou 61999991234')).toBe(`zap ${HIDDEN_MARK} ou ${HIDDEN_MARK}`);
    expect(redact('veja www.site.com.br')).toBe(`veja ${HIDDEN_MARK}`);
    expect(redact('matrícula 20240123')).toBe(`matrícula ${HIDDEN_MARK}`);
  });
  it('oculta palavras dos apelidos das equipes, sem acento nem maiúsculas', () => {
    expect(redact('a equipe ipe errou', ['Equipe Ipê'])).toBe(`a equipe ${HIDDEN_MARK} errou`);
    expect(redact('Fomos os Girassol!', ['Equipe Girassol'])).toBe(`Fomos os ${HIDDEN_MARK}`);
  });
  it('sugere ocultar nomes próprios no meio da frase, mas não o início das frases', () => {
    expect(redact('Eu, Maria Souza, multipliquei.')).toBe(`Eu, ${HIDDEN_MARK} ${HIDDEN_MARK} multipliquei.`);
    expect(redact('Multipliquei as diagonais. Depois dividi.')).toBe('Multipliquei as diagonais. Depois dividi.');
  });
  it('não oculta termos de matemática nem números pequenos', () => {
    expect(redact('Metade do Losango: 10 x 6 : 2 = 30')).toBe('Metade do Losango: 10 x 6 : 2 = 30');
    expect(redact('as Diagonais medem 12 e 4')).toBe('as Diagonais medem 12 e 4');
  });
  it('o professor pode mostrar ou ocultar qualquer palavra', () => {
    const tokens = tokenize('Eu, Maria Souza, achei 60');
    const hidden = initialHidden(tokens);
    const maria = tokens.findIndex((t) => t.text === 'Maria');
    hidden[maria] = false;
    const sixty = tokens.findIndex((t) => t.text === '60');
    hidden[sixty] = true;
    expect(applyHidden(tokens, hidden)).toBe(`Eu, Maria ${HIDDEN_MARK} achei ${HIDDEN_MARK}`);
  });
  it('preserva texto vazio', () => {
    expect(redact('')).toBe('');
  });
});
