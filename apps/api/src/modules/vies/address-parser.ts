/**
 * Fase 4.2 (P1.1) — partir a morada de uma linha só (como o VIES a
 * devolve) em morada + código postal + cidade.
 *
 * O painel da ficha de fornecedor já mostra "Morada (VIES)" e
 * "Nome (VIES)" corretamente — os dados chegam. O que faltava era
 * escrevê-los nos campos reais da entidade (`name`, `address`, `city`,
 * `postalCode`) em vez de os deixar só no cache `viesName`/`viesAddress`.
 * Esta função resolve o lado da morada: dá-lhe a última linha (ou o
 * resto da string) e devolve os três campos.
 *
 * Formatos cobertos:
 *   PT   NNNN-NNN CIDADE               (ex.: "2660-001 FRIELAS")
 *   ES   NNNNN CIDADE (PROVINCIA)?     (ex.: "28001 MADRID")
 *   FR   NNNNN VILLE                   (ex.: "75001 PARIS")
 *   DE   NNNNN Stadt                   (ex.: "10115 Berlin")
 *
 * Função pura e testada — sem Prisma, sem rede.
 */

export interface ParsedAddress {
  /** O resto da morada, sem o código postal nem a cidade. */
  address: string | null;
  postalCode: string | null;
  city: string | null;
}

const PT_POSTAL = /\b(\d{4}-\d{3})\s+(.+)$/;
const GENERIC_POSTAL = /\b(\d{4,5})\s+(.+)$/;

export function parsePostalAddress(raw: string | null | undefined): ParsedAddress {
  if (!raw) return { address: null, postalCode: null, city: null };
  const cleaned = raw.replace(/\r/g, '').trim();
  if (!cleaned) return { address: null, postalCode: null, city: null };

  // O VIES devolve por vezes várias linhas (rua \n cidade \n código
  // postal + cidade outra vez). A última linha não vazia é a que
  // normalmente traz o código postal.
  const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? cleaned;
  const rest = lines.slice(0, -1).join(', ');

  const ptMatch = lastLine.match(PT_POSTAL);
  if (ptMatch) {
    const prefixOnLastLine = lastLine.slice(0, ptMatch.index).replace(/[,\s]+$/, '').trim();
    const fullAddress = [rest, prefixOnLastLine].filter(Boolean).join(', ');
    return {
      address: fullAddress || null,
      postalCode: ptMatch[1],
      city: ptMatch[2].trim() || null,
    };
  }

  const genericMatch = lastLine.match(GENERIC_POSTAL);
  if (genericMatch) {
    const prefixOnLastLine = lastLine.slice(0, genericMatch.index).replace(/[,\s]+$/, '').trim();
    const fullAddress = [rest, prefixOnLastLine].filter(Boolean).join(', ');
    return {
      address: fullAddress || null,
      postalCode: genericMatch[1],
      // Remove uma província entre parênteses quando presente (formato ES).
      city: genericMatch[2].replace(/\s*\([^)]*\)\s*$/, '').trim() || null,
    };
  }

  // Sem código postal reconhecível — a linha toda fica como cidade
  // quando é a única linha, ou como parte da morada quando há mais.
  if (lines.length > 1) {
    return { address: rest || null, postalCode: null, city: lastLine || null };
  }
  return { address: cleaned, postalCode: null, city: null };
}

/**
 * True quando o nome atual não é um nome de verdade — vazio, o
 * sentinela genérico, ou o próprio NIF/NIF-IVA repetido como nome.
 * Só nestes casos é seguro substituir pelo nome oficial do VIES.
 */
export function isGenericPartyName(
  name: string | null | undefined,
  nif?: string | null,
  vatNumber?: string | null,
): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  if (n.toLowerCase() === 'fornecedor por identificar') return true;
  if (nif && n === nif) return true;
  if (vatNumber && n === vatNumber) return true;
  return false;
}
