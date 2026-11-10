import type { EpochMs } from '@/domain/shared/types';
import type { CardState } from '@/domain/srs/types';

/**
 * État visuel d'un nœud de la carte de progression.
 *
 * Extrait de `ProgressScreen` pour que le fichier d'écran n'exporte que des
 * composants (contrainte `react-refresh`) — et pour que cette règle soit
 * testable et déplaçable vers `selectors.ts` le jour où un sélecteur l'exposera.
 */
export type NodeState = 'locked' | 'available' | 'due' | 'learning' | 'mastered';

/** Entrées de la dérivation : tout est fourni, rien n'est lu implicitement. */
export interface DeriveNodeStateInput {
  readonly actUnlocked: boolean;
  readonly mastered: boolean;
  readonly card: CardState | undefined;
  /** Instant injecté par `ClockPort` (jamais `Date.now()`, ADR 0008). */
  readonly now: EpochMs;
}

/**
 * Dérive l'état d'un nœud à partir de la maîtrise, de l'acte et de la carte.
 *
 * Ordre de priorité : verrouillé (acte) > maîtrisé > neuf (disponible) >
 * échéance atteinte (dû) > en apprentissage > disponible.
 */
export function deriveNodeState(input: DeriveNodeStateInput): NodeState {
  const { actUnlocked, mastered, card, now } = input;
  if (!actUnlocked) {
    return 'locked';
  }
  if (mastered) {
    return 'mastered';
  }
  if (card === undefined || card.phase === 'new') {
    return 'available';
  }
  if (card.dueAt <= now) {
    return 'due';
  }
  if (card.phase === 'learning' || card.phase === 'relearning') {
    return 'learning';
  }
  return 'available';
}
