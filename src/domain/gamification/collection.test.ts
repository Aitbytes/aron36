import { describe, expect, it } from 'vitest';

import type { QuestionId } from '@/domain/shared/types';
import type { QuestionMastery } from '@/domain/mastery/types';
import {
  EMPTY_COLLECTION,
  actOfQuestion,
  collectionEvaluator,
  masteryTierFor,
  rarityForAct,
} from './collection';
import { COLLECTION_MASTERY_TIER_DAYS } from './types';

/**
 * Anti-objectifs servis (docs/ARCHITECTURE.md § 8.6) :
 * - « pas de récompense sans production » : aucune carte avant la maîtrise ;
 * - « pas de rareté artificielle » : la rareté dérive de l’acte, et les 5 paliers
 *   de maîtrise (21 → 180 jours) sont atteignables ;
 * - « pas de doublon » : une question n’est jamais collectionnée deux fois.
 */

function mastery(questionId: QuestionId, mastered: boolean): QuestionMastery {
  return {
    questionId,
    cardMastered: mastered,
    directions: [],
    distinctDirections: 0,
    mastered,
  };
}

describe('collection — obtention à la maîtrise', () => {
  it('n’ajoute aucune carte avant la maîtrise', () => {
    const result = collectionEvaluator.update({
      state: EMPTY_COLLECTION,
      mastery: mastery(7, false),
      now: 1000,
    });
    expect(result.unlocked).toBe(false);
    expect(result.previousTier).toBeNull();
    expect(result.state.entries).toEqual([]);
  });

  it('ajoute une carte au premier franchissement de la maîtrise', () => {
    const result = collectionEvaluator.update({
      state: EMPTY_COLLECTION,
      mastery: mastery(7, true),
      now: 1000,
    });
    expect(result.unlocked).toBe(true);
    expect(result.previousTier).toBeNull();
    expect(result.state.entries).toEqual([
      { questionId: 7, rarity: 'common', obtainedAt: 1000, masteryTier: 1 },
    ]);
  });

  it('ne crée jamais deux fois la même carte et ne rétrograde jamais le palier', () => {
    const first = collectionEvaluator.update({
      state: EMPTY_COLLECTION,
      mastery: mastery(30, true),
      now: 1000,
    });
    const second = collectionEvaluator.update({
      state: first.state,
      mastery: mastery(30, true),
      now: 2000,
    });
    expect(second.unlocked).toBe(false);
    expect(second.previousTier).toBe(1);
    expect(second.state.entries).toHaveLength(1);
    expect(second.state.entries[0]?.obtainedAt).toBe(1000);
  });

  it('renvoie le palier existant quand la maîtrise régresse', () => {
    const first = collectionEvaluator.update({
      state: EMPTY_COLLECTION,
      mastery: mastery(4, true),
      now: 1000,
    });
    const regressed = collectionEvaluator.update({
      state: first.state,
      mastery: mastery(4, false),
      now: 2000,
    });
    expect(regressed.unlocked).toBe(false);
    expect(regressed.previousTier).toBe(1);
    expect(regressed.state).toEqual(first.state);
  });

  it('dérive la rareté de l’acte, jamais du hasard', () => {
    expect(rarityForAct(1)).toBe('common');
    expect(rarityForAct(2)).toBe('rare');
    expect(rarityForAct(3)).toBe('epic');
    expect(actOfQuestion(1)).toBe(1);
    expect(actOfQuestion(12)).toBe(1);
    expect(actOfQuestion(13)).toBe(2);
    expect(actOfQuestion(24)).toBe(2);
    expect(actOfQuestion(25)).toBe(3);
    expect(actOfQuestion(36)).toBe(3);
    expect(actOfQuestion(0)).toBe(1);
    expect(actOfQuestion(99)).toBe(3);
  });

  it('accumule les cartes sans doublon sur les 36 questions', () => {
    let state = EMPTY_COLLECTION;
    for (let questionId = 1; questionId <= 36; questionId += 1) {
      const result = collectionEvaluator.update({
        state,
        mastery: mastery(questionId, true),
        now: questionId,
      });
      expect(result.unlocked).toBe(true);
      state = result.state;
    }
    expect(state.entries).toHaveLength(36);
    expect(new Set(state.entries.map((entry) => entry.questionId)).size).toBe(36);
    expect(state.entries.filter((entry) => entry.rarity === 'common')).toHaveLength(12);
    expect(state.entries.filter((entry) => entry.rarity === 'rare')).toHaveLength(12);
    expect(state.entries.filter((entry) => entry.rarity === 'epic')).toHaveLength(12);
  });
});

describe('collection — cinq paliers atteignables', () => {
  it('couvre les 5 paliers du contrat, sans trou', () => {
    expect(COLLECTION_MASTERY_TIER_DAYS).toHaveLength(5);
    expect(masteryTierFor(0)).toBe(1);
    expect(masteryTierFor(20)).toBe(1);
    expect(masteryTierFor(21)).toBe(1);
    expect(masteryTierFor(39)).toBe(1);
    expect(masteryTierFor(40)).toBe(2);
    expect(masteryTierFor(69)).toBe(2);
    expect(masteryTierFor(70)).toBe(3);
    expect(masteryTierFor(119)).toBe(3);
    expect(masteryTierFor(120)).toBe(4);
    expect(masteryTierFor(179)).toBe(4);
    expect(masteryTierFor(180)).toBe(5);
    expect(masteryTierFor(10_000)).toBe(5);
  });

  it('atteint chaque palier en atteignant chaque seuil du contrat', () => {
    const tiers = COLLECTION_MASTERY_TIER_DAYS.map((days) => masteryTierFor(days));
    expect(tiers).toEqual([1, 2, 3, 4, 5]);
  });
});
