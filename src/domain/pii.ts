/**
 * Verificação mínima de dados pessoais em campos livres (cálculo e justificativa).
 * Regras iguais no navegador (DEMONSTRAÇÃO) e no servidor (SQL): e-mail, endereço da internet e
 * números de 4 ou mais algarismos seguidos. Nomes próprios NÃO podem ser detectados de forma confiável;
 * por isso o professor revisa o texto antes de projetá-lo.
 */
export const PERSONAL_DATA_MESSAGE =
  'Não escrevam e-mails, endereços da internet, telefones ou números com 4 ou mais algarismos seguidos.';

export function containsPersonalData(text: string): boolean {
  if (text.includes('@')) return true;
  if (/(https?:|www\.)/i.test(text)) return true;
  if (/\.(com|net|org|br)\b/i.test(text)) return true;
  if (/\d{4,}/.test(text)) return true;
  return false;
}
