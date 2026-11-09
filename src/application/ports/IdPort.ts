import type { ReviewLogId, SessionId } from '@/domain/shared/types';

/**
 * Port de génération d'identifiants opaques.
 *
 * Le domaine est pur : il ne peut pas appeler `crypto`, `Date` ni `Math.random`.
 * Il reçoit donc ses identifiants déjà fabriqués. Ce port est la **seule**
 * frontière autorisée à produire de l'aléa non déterministe, avec `RandomPort`
 * pour les graines.
 *
 * En production : UUID v4 via `crypto.randomUUID`. En test : compteur
 * incrémental, ce qui rend les identifiants prévisibles et comparables.
 */
export interface IdPort {
  /** Identifiant d'une nouvelle session d'entraînement. */
  newSessionId(): SessionId;
  /** Identifiant d'une nouvelle ligne de journal de révision. */
  newReviewLogId(): ReviewLogId;
  /** Identifiant du profil local, généré une seule fois à la première ouverture. */
  newProfileId(): string;
}
