import type { IdPort } from '@/application/ports/IdPort';
import type { ReviewLogId, SessionId } from '@/domain/shared/types';

/**
 * Identifiants opaques via `crypto.randomUUID` (ADR 0008).
 *
 * Les identifiants portent un préfixe court pour la lisibilité des journaux
 * (`s_` session, `r_` révision, `p_` profil) : un dump de `localStorage` ou un
 * rapport de bug reste lisible à l'œil nu.
 *
 * Repli en cascade si `randomUUID` manque (contextes non sécus ou vieux
 * moteurs) : octets aléatoires de `crypto.getRandomValues`, puis `Math.random`
 * en dernier recours — l'unicité locale reste suffisante pour un identifiant
 * d'appareil, sans aucune valeur secrète en jeu.
 */
export interface CryptoIdPortOptions {
  /** Générateur d'UUID injectable pour les tests déterministes. */
  readonly uuid?: (() => string) | undefined;
}

export class CryptoIdPort implements IdPort {
  private readonly uuid: () => string;

  constructor(options: CryptoIdPortOptions = {}) {
    this.uuid = options.uuid ?? randomUuid;
  }

  newSessionId(): SessionId {
    return `s_${this.uuid()}`;
  }

  newReviewLogId(): ReviewLogId {
    return `r_${this.uuid()}`;
  }

  newProfileId(): string {
    return `p_${this.uuid()}`;
  }
}

function randomUuid(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef !== undefined && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  if (cryptoRef !== undefined && typeof cryptoRef.getRandomValues === 'function') {
    return uuidFromBytes(cryptoRef.getRandomValues(new Uint8Array(16)));
  }
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return uuidFromBytes(bytes);
}

/** Formate 16 octets en UUID v4 canonique (version et variante forcées). */
function uuidFromBytes(bytes: Uint8Array): string {
  const byteAt = (index: number): number => bytes[index] ?? 0;
  bytes[6] = (byteAt(6) & 0x0f) | 0x40;
  bytes[8] = (byteAt(8) & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let index = 0; index < 16; index += 1) {
    hex.push(byteAt(index).toString(16).padStart(2, '0'));
  }
  const join = (from: number, to: number): string => hex.slice(from, to).join('');
  return `${join(0, 4)}-${join(4, 6)}-${join(6, 8)}-${join(8, 10)}-${join(10, 16)}`;
}
