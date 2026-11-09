import { ACT_COUNT, QUESTIONS_PER_ACT } from '@/domain/shared/types';
import type { ActId, QuestionId } from '@/domain/shared/types';
import type {
  CardRarity,
  CollectionEntry,
  CollectionEvaluator,
  CollectionState,
  CollectionUpdate,
  CollectionUpdateInput,
} from './types';
import { COLLECTION_ENTRY_MIN_INTERVAL_DAYS, COLLECTION_MASTERY_TIER_DAYS } from './types';

/**
 * Collection des 36 cartes (L14).
 *
 * Anti-objectifs servis par ce module :
 * - **pas de rareté artificielle** : la rareté dérive de l'acte, jamais du
 *   hasard ; les cinq paliers de maîtrise sont atteignables (21 → 180 jours) ;
 * - **pas de récompense sans production** : une carte n'est créée qu'à la
 *   **maîtrise** d'une question, jamais après une simple réussite ;
 * - **pas de doublon** : une question déjà collectionnée n'est jamais ré-ajoutée
 *   et son palier n'est jamais rétrogradé.
 */

/** Acte d'une question, déduit de son rang (12 questions par acte). */
export function actOfQuestion(questionId: QuestionId): ActId {
  const act = Math.ceil(questionId / QUESTIONS_PER_ACT);
  if (act <= 1) {
    return 1;
  }
  return act >= ACT_COUNT ? 3 : 2;
}

/** Rareté cosmétique d'une carte, dérivée de l'acte. */
export function rarityForAct(actId: ActId): CardRarity {
  if (actId === 1) {
    return 'common';
  }
  return actId === 2 ? 'rare' : 'epic';
}

/**
 * Palier de maîtrise (1..5) atteint pour un intervalle SRS donné.
 *
 * `COLLECTION_MASTERY_TIER_DAYS` vaut `[21, 40, 70, 120, 180]` (gelé par la
 * Phase 1) : le palier 1 est acquis à la maîtrise, le palier 5 à l'intervalle
 * maximal du SRS. Aucun palier n'est inatteignable.
 */
export function masteryTierFor(intervalDays: number): 1 | 2 | 3 | 4 | 5 {
  if (intervalDays >= COLLECTION_MASTERY_TIER_DAYS[4]) {
    return 5;
  }
  if (intervalDays >= COLLECTION_MASTERY_TIER_DAYS[3]) {
    return 4;
  }
  if (intervalDays >= COLLECTION_MASTERY_TIER_DAYS[2]) {
    return 3;
  }
  if (intervalDays >= COLLECTION_MASTERY_TIER_DAYS[1]) {
    return 2;
  }
  return 1;
}

/**
 * Évaluation d'une question.
 *
 * Limite du contrat gelé : `CollectionUpdateInput` ne transporte pas
 * l'intervalle SRS de la carte (`QuestionMastery` n'en porte pas). La maîtrise
 * garantit au minimum `COLLECTION_ENTRY_MIN_INTERVAL_DAYS` jours d'intervalle,
 * donc le palier plancher 1 ; `masteryTierFor` est exporté pour que la Phase 3
 * affine le palier lorsqu'elle dispose de la `CardState`.
 */
function update(input: CollectionUpdateInput): CollectionUpdate {
  const { state, mastery, now } = input;
  const existing = state.entries.find((entry) => entry.questionId === mastery.questionId);

  if (!mastery.mastered) {
    return { state, unlocked: false, previousTier: existing?.masteryTier ?? null };
  }
  if (existing !== undefined) {
    return { state, unlocked: false, previousTier: existing.masteryTier };
  }

  const entry: CollectionEntry = {
    questionId: mastery.questionId,
    rarity: rarityForAct(actOfQuestion(mastery.questionId)),
    obtainedAt: now,
    masteryTier: masteryTierFor(COLLECTION_ENTRY_MIN_INTERVAL_DAYS),
  };

  return {
    state: { entries: [...state.entries, entry] },
    unlocked: true,
    previousTier: null,
  };
}

/** Tenue à jour pure de la collection : jamais d'ajout hors maîtrise. */
export const collectionEvaluator: CollectionEvaluator = { update };

/** État de collection vide, pour les tests et l'état initial d'un joueur. */
export const EMPTY_COLLECTION: CollectionState = { entries: [] };
