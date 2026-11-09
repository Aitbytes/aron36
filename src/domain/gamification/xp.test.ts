import { describe, expect, it } from 'vitest';

import { DRILL_DIRECTIONS, REVIEW_GRADES } from '@/domain/shared/types';
import type { DrillDirection, ExerciseKind } from '@/domain/shared/types';
import { antiFarmFactorFor, xpCalculator } from './xp';
import type { AnswerXpInput, XpContext, XpRules } from './types';
import { XP_RULES } from './types';

/**
 * Anti-objectifs vérifiés ici (docs/ARCHITECTURE.md § 8.7, PLAN.md § Anti-objectifs) :
 * - « pas de ludification substitutive » : aucune XP sans production réelle ;
 * - « pas de reconnaissance déguisée en rappel » : la discrimination rapporte au
 *   plus la moitié d'une production équivalente ;
 * - « pas de punition » : jamais de montant négatif.
 */

function context(overrides: Partial<XpContext> = {}): XpContext {
  return {
    rules: XP_RULES,
    sameDayAnswersForQuestion: 0,
    isFirstExposure: false,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

function answer(overrides: Partial<AnswerXpInput> = {}): AnswerXpInput {
  return {
    questionId: 1,
    direction: 'keyword-to-question',
    exerciseKind: 'production',
    grade: 'good',
    responseTimeMs: 9000,
    hintsUsed: 1,
    ...overrides,
  };
}

describe('xp — la production réelle est la seule source d’XP', () => {
  it('ne donne aucune XP pour again, quelle que soit la direction', () => {
    for (const direction of DRILL_DIRECTIONS) {
      for (const exerciseKind of ['production', 'discrimination'] satisfies ExerciseKind[]) {
        const award = xpCalculator.forAnswer(
          answer({ direction, exerciseKind, grade: 'again', hintsUsed: 0, responseTimeMs: 500 }),
          context({ isFirstExposure: true }),
        );
        expect(award.amount).toBe(0);
        expect(award.breakdown?.total).toBe(0);
      }
    }
  });

  it('ne donne aucune XP pour une révélation (note again) ni pour un clic', () => {
    // Un clic « suivant » ou une révélation n’a pas d’entrée d’XP : le seul
    // chemin d’XP est une réponse notée, et `again` vaut 0.
    const award = xpCalculator.forAnswer(answer({ grade: 'again' }), context());
    expect(award.amount).toBe(0);
    expect(award.breakdown).not.toBeNull();
  });

  it('plafonne la discrimination à la moitié d’une production équivalente', () => {
    for (const direction of DRILL_DIRECTIONS) {
      for (const grade of REVIEW_GRADES) {
        for (const isFirstExposure of [false, true]) {
          for (const hintsUsed of [0, 1]) {
            for (const responseTimeMs of [1000, 9000]) {
              for (const sameDayAnswersForQuestion of [0, 1, 2, 3]) {
                const shared = { direction, grade, hintsUsed, responseTimeMs };
                const ctx = context({ isFirstExposure, sameDayAnswersForQuestion });
                const production = xpCalculator.forAnswer(
                  answer({ ...shared, exerciseKind: 'production' }),
                  ctx,
                );
                const discrimination = xpCalculator.forAnswer(
                  answer({ ...shared, exerciseKind: 'discrimination' }),
                  ctx,
                );
                expect(discrimination.amount).toBeLessThanOrEqual(
                  Math.floor(production.amount / 2),
                );
                expect(discrimination.reason).toBe('discrimination-answer');
              }
            }
          }
        }
      }
    }
  });

  it('réserve les bonus à la production : une discrimination n’en reçoit aucun', () => {
    const discrimination = xpCalculator.forAnswer(
      answer({
        direction: 'number-to-question',
        exerciseKind: 'discrimination',
        grade: 'easy',
        hintsUsed: 0,
        responseTimeMs: 1000,
      }),
      context({ isFirstExposure: true }),
    );
    expect(discrimination.breakdown?.firstExposureBonus).toBe(0);
    expect(discrimination.breakdown?.noHintBonus).toBe(0);
    expect(discrimination.breakdown?.speedBonus).toBe(0);
    expect(discrimination.amount).toBe(
      Math.floor(
        (XP_RULES.baseByDirection['number-to-question'] * XP_RULES.gradeMultiplier.easy) / 2,
      ),
    );
  });

  it('applique l’exemple du contrat : mot-clé, good, sans indice, 3 s, 1re exposition', () => {
    const award = xpCalculator.forAnswer(
      answer({
        direction: 'keyword-to-question',
        grade: 'good',
        hintsUsed: 0,
        responseTimeMs: 3000,
      }),
      context({ isFirstExposure: true }),
    );
    expect(award.amount).toBe(19);
    expect(award.reason).toBe('production-answer');
    expect(award.questionId).toBe(1);
    expect(award.breakdown).toEqual({
      base: 10,
      gradeAdjusted: 10,
      firstExposureBonus: 5,
      noHintBonus: 2,
      speedBonus: 2,
      antiFarmFactor: 1,
      total: 19,
    });
  });
});

describe('xp — anti-farm par question et par jour', () => {
  it('décroît 1re ×1, 2e ×0.5, 3e ×0.25, 4e et suivantes ×0', () => {
    const base = answer({ direction: 'keyword-to-question', grade: 'good' });
    const expected = [10, 5, 2, 0, 0, 0];
    expected.forEach((amount, sameDayAnswersForQuestion) => {
      const award = xpCalculator.forAnswer(
        base,
        context({ sameDayAnswersForQuestion, rules: XP_RULES }),
      );
      expect(award.amount).toBe(amount);
    });
    expect(
      xpCalculator.forAnswer(base, context({ sameDayAnswersForQuestion: 0 })).breakdown
        ?.antiFarmFactor,
    ).toBe(1);
    expect(
      xpCalculator.forAnswer(base, context({ sameDayAnswersForQuestion: 1 })).breakdown
        ?.antiFarmFactor,
    ).toBe(0.5);
    expect(
      xpCalculator.forAnswer(base, context({ sameDayAnswersForQuestion: 2 })).breakdown
        ?.antiFarmFactor,
    ).toBe(0.25);
    expect(
      xpCalculator.forAnswer(base, context({ sameDayAnswersForQuestion: 3 })).breakdown
        ?.antiFarmFactor,
    ).toBe(0);
    expect(
      xpCalculator.forAnswer(base, context({ sameDayAnswersForQuestion: 4 })).breakdown
        ?.antiFarmFactor,
    ).toBe(0);
  });

  it('traite un compteur négatif comme une première réponse', () => {
    expect(antiFarmFactorFor(XP_RULES, -3)).toBe(1);
    expect(antiFarmFactorFor(XP_RULES, 0.9)).toBe(1);
    expect(antiFarmFactorFor(XP_RULES, 99)).toBe(0);
  });

  it('ne contourne pas l’anti-farm par les bonus de session', () => {
    const award = xpCalculator.forSession(
      { sessionId: 's-1', itemCount: 20, productionCount: 20, correctCount: 20 },
      context({ sameDayAnswersForQuestion: 9 }),
    );
    expect(award.amount).toBe(XP_RULES.sessionCompletionXp + XP_RULES.perfectSessionBonus);
    expect(award.breakdown).toBeNull();
  });
});

describe('xp — détail auditable et arrondis', () => {
  it('vérifie l’identité d’audit pour toutes les combinaisons', () => {
    for (const direction of DRILL_DIRECTIONS) {
      for (const grade of REVIEW_GRADES) {
        for (const exerciseKind of ['production', 'discrimination'] satisfies ExerciseKind[]) {
          for (const sameDay of [0, 1, 2, 3]) {
            const award = xpCalculator.forAnswer(
              answer({ direction, grade, exerciseKind, hintsUsed: 0, responseTimeMs: 1000 }),
              context({ isFirstExposure: true, sameDayAnswersForQuestion: sameDay }),
            );
            const breakdown = award.breakdown;
            expect(breakdown).not.toBeNull();
            if (breakdown === null) {
              throw new Error('un gain de réponse porte toujours un détail');
            }
            const subtotal =
              breakdown.gradeAdjusted +
              breakdown.firstExposureBonus +
              breakdown.noHintBonus +
              breakdown.speedBonus;
            expect(Math.floor(subtotal * breakdown.antiFarmFactor)).toBe(award.amount);
            if (breakdown.antiFarmFactor === 1) {
              expect(subtotal).toBe(award.amount);
            }
            expect(breakdown.total).toBe(award.amount);
            expect(award.amount).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('arrondit vers le bas sans jamais descendre sous zéro', () => {
    const rules: XpRules = { ...XP_RULES, antiFarmFactors: [0.5] };
    const award = xpCalculator.forAnswer(
      answer({
        direction: 'keyword-to-question',
        grade: 'hard',
        hintsUsed: 1,
        responseTimeMs: 9000,
      }),
      context({ rules }),
    );
    // 10 × 0.5 = 5 ; 5 × 0.5 = 2.5 → 2.
    expect(award.amount).toBe(2);
    expect(award.breakdown?.antiFarmFactor).toBe(0.5);
  });

  it('n’accorde le bonus de rapidité qu’à la limite inclusive', () => {
    const atThreshold = xpCalculator.forAnswer(
      answer({ responseTimeMs: XP_RULES.speedThresholdMs }),
      context(),
    );
    const aboveThreshold = xpCalculator.forAnswer(
      answer({ responseTimeMs: XP_RULES.speedThresholdMs + 1 }),
      context(),
    );
    expect(atThreshold.breakdown?.speedBonus).toBe(XP_RULES.speedBonus);
    expect(aboveThreshold.breakdown?.speedBonus).toBe(0);
  });

  it('n’accorde le bonus de première exposition qu’une fois, et pas sur again', () => {
    const first = xpCalculator.forAnswer(answer(), context({ isFirstExposure: true }));
    const later = xpCalculator.forAnswer(answer(), context({ isFirstExposure: false }));
    const failed = xpCalculator.forAnswer(
      answer({ grade: 'again' }),
      context({ isFirstExposure: true }),
    );
    expect(first.breakdown?.firstExposureBonus).toBe(XP_RULES.firstExposureBonus);
    expect(later.breakdown?.firstExposureBonus).toBe(0);
    expect(failed.breakdown?.firstExposureBonus).toBe(0);
  });

  it('n’accorde le bonus sans indice qu’à zéro indice et hors again', () => {
    const clean = xpCalculator.forAnswer(answer({ hintsUsed: 0 }), context());
    const hinted = xpCalculator.forAnswer(answer({ hintsUsed: 1 }), context());
    const failed = xpCalculator.forAnswer(answer({ hintsUsed: 0, grade: 'again' }), context());
    expect(clean.breakdown?.noHintBonus).toBe(XP_RULES.noHintBonus);
    expect(hinted.breakdown?.noHintBonus).toBe(0);
    expect(failed.breakdown?.noHintBonus).toBe(0);
  });
});

describe('xp — bonus de session', () => {
  it('récompense une session terminée de 10 XP', () => {
    const award = xpCalculator.forSession(
      { sessionId: 's-1', itemCount: 8, productionCount: 8, correctCount: 5 },
      context(),
    );
    expect(award.amount).toBe(XP_RULES.sessionCompletionXp);
    expect(award.reason).toBe('session-complete');
    expect(award.questionId).toBeNull();
    expect(award.breakdown).toBeNull();
  });

  it('ajoute le bonus parfait pour une session 100 % d’au moins 5 items', () => {
    const award = xpCalculator.forSession(
      { sessionId: 's-1', itemCount: 12, productionCount: 12, correctCount: 12 },
      context(),
    );
    expect(award.amount).toBe(XP_RULES.sessionCompletionXp + XP_RULES.perfectSessionBonus);
    expect(award.reason).toBe('perfect-session');
  });

  it('ne récompense ni une session vide ni une session presque parfaite', () => {
    expect(
      xpCalculator.forSession(
        { sessionId: 's-0', itemCount: 0, productionCount: 0, correctCount: 0 },
        context(),
      ).amount,
    ).toBe(0);
    expect(
      xpCalculator.forSession(
        { sessionId: 's-2', itemCount: 12, productionCount: 12, correctCount: 11 },
        context(),
      ).amount,
    ).toBe(XP_RULES.sessionCompletionXp);
    expect(
      xpCalculator.forSession(
        { sessionId: 's-3', itemCount: 4, productionCount: 4, correctCount: 4 },
        context(),
      ).amount,
    ).toBe(XP_RULES.sessionCompletionXp);
  });

  it('n’accorde pas le bonus parfait à une session 100 % QCM', () => {
    const award = xpCalculator.forSession(
      { sessionId: 's-qcm', itemCount: 12, productionCount: 0, correctCount: 12 },
      context(),
    );
    expect(award.amount).toBe(XP_RULES.sessionCompletionXp);
    expect(award.reason).toBe('session-complete');
  });

  it('ne donne jamais un montant négatif ni un détail incohérent', () => {
    for (const grade of REVIEW_GRADES) {
      const direction: DrillDirection = 'order-to-question';
      const award = xpCalculator.forAnswer(
        answer({ grade, direction }),
        context({ sameDayAnswersForQuestion: 3 }),
      );
      expect(award.amount).toBeGreaterThanOrEqual(0);
    }
  });
});
