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
 * - **pas de rareté artificielle** : la rareté dérive de l'acte et le palier de
 *   l'intervalle SRS réel, jamais du hasard ; les cinq paliers de maîtrise sont
 *   atteignables (21 → 180 jours) et un palier franchi est écrit ;
 * - **pas de récompense sans production** : une carte n'est créée qu'à la
 *   **maîtrise** d'une question, jamais après une simple réussite ;
 * - **pas de doublon** : une question déjà collectionnée n'est jamais ré-ajoutée
 *   et son palier n'est jamais rétrogradé (aucune punition).
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

/** Palier plancher d'une carte neuve : la maîtrise garantit le premier seuil. */
const MIN_TIER = masteryTierFor(COLLECTION_ENTRY_MIN_INTERVAL_DAYS);

/**
 * Évaluation d'une question.
 *
 * Le palier est **recalculé à chaque évaluation** depuis `intervalDays` : une
 * carte déjà obtenue progresse donc de palier au fil des révisions espacées.
 * Le palier ne redescend jamais, même si la maîtrise ou l'intervalle régresse.
 */
function update(input: CollectionUpdateInput): CollectionUpdate {
  const { state, mastery, intervalDays, now } = input;
  const existing = state.entries.find((entry) => entry.questionId === mastery.questionId);
  const tier = masteryTierFor(intervalDays);

  if (!mastery.mastered) {
    return { state, unlocked: false, previousTier: existing?.masteryTier ?? null };
  }
  if (existing === undefined) {
    const entry: CollectionEntry = {
      questionId: mastery.questionId,
      rarity: rarityForAct(actOfQuestion(mastery.questionId)),
      obtainedAt: now,
      // Plancher de maîtrise : `COLLECTION_ENTRY_MIN_INTERVAL_DAYS` vaut le
      // premier seuil, donc une entrée neuve vaut au moins le palier 1.
      masteryTier: tier >= MIN_TIER ? tier : MIN_TIER,
    };
    return {
      state: { entries: [...state.entries, entry] },
      unlocked: true,
      previousTier: null,
    };
  }
  if (tier <= existing.masteryTier) {
    return { state, unlocked: false, previousTier: existing.masteryTier };
  }

  // Palier franchi : l'entrée évolue, la date d'obtention est conservée.
  const upgraded: CollectionEntry = { ...existing, masteryTier: tier };
  return {
    state: {
      entries: state.entries.map((entry) =>
        entry.questionId === existing.questionId ? upgraded : entry,
      ),
    },
    unlocked: false,
    previousTier: existing.masteryTier,
  };
}

/** Tenue à jour pure de la collection : jamais d'ajout hors maîtrise. */
export const collectionEvaluator: CollectionEvaluator = { update };

/** État de collection vide, pour les tests et l'état initial d'un joueur. */
export const EMPTY_COLLECTION: CollectionState = { entries: [] };
