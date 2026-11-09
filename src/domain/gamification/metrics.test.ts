import { describe, expect, it } from 'vitest';

import { DAY_MS } from '@/domain/shared/types';
import type { DrillDirection, QuestionId, ReviewGrade } from '@/domain/shared/types';
import type { QuestionMastery } from '@/domain/mastery/types';
import type { ReviewLog } from '@/domain/srs/types';
import type { SessionLog } from '@/domain/session/types';
import { EMPTY_COLLECTION } from './collection';
import { metricsCalculator } from './metrics';
import type { MetricsInput, StreakState } from './types';

/**
 * Anti-objectifs servis (docs/ARCHITECTURE.md § 8.7, PLAN.md § Anti-objectifs) :
 * - « pas de compteur persisté » : tout est recalculé depuis les journaux ;
 * - « pas de punition » : la précision est une moyenne pondérée par
 *   `ACCURACY_CREDIT` (un `hard` vaut 0.5), jamais un compteur de fautes ;
 * - « pas de reconnaissance déguisée en rappel » : les métriques de production
 *   (précision par direction, sans indice, session parfaite, questions
 *   distinctes) ignorent le QCM ;
 * - L12 : `calibrationGap` vaut `null` sans jugement de confiance, pour ne jamais
 *   afficher un chiffre inventé.
 */

function log(overrides: Partial<ReviewLog> = {}): ReviewLog {
  const base: ReviewLog = {
    id: 'log',
    sessionId: 'session',
    questionId: 1,
    direction: 'keyword-to-question',
    exerciseKind: 'production',
    grade: 'good',
    reviewedAt: 0,
    previousDueAt: null,
    nextDueAt: DAY_MS,
    intervalDays: 1,
    elapsedDays: 0,
    responseTimeMs: 3000,
    hintsUsed: 0,
    confidence: null,
  };
  return { ...base, ...overrides };
}

function session(overrides: Partial<SessionLog> = {}): SessionLog {
  const base: SessionLog = {
    sessionId: 'session',
    mode: 'review',
    planSeed: 'seed',
    startedAt: 0,
    endedAt: 60_000,
    durationMs: 60_000,
    window: 'day',
    itemCount: 10,
    productionCount: 10,
    discriminationCount: 0,
    spokenCount: 0,
    correctCount: 8,
    accuracy: 0.8,
    xpAwarded: 50,
  };
  return { ...base, ...overrides };
}

function questionMastery(questionId: QuestionId, mastered: boolean): QuestionMastery {
  return { questionId, cardMastered: mastered, directions: [], distinctDirections: 0, mastered };
}

const STREAK: StreakState = {
  current: 4,
  longest: 9,
  lastActiveDay: '2024-03-10',
  freezes: 1,
  frozenDays: [],
};

function metricsInput(overrides: Partial<MetricsInput> = {}): MetricsInput {
  return {
    reviewLogs: [],
    sessionLogs: [],
    mastery: [],
    hooksCount: 0,
    collection: EMPTY_COLLECTION,
    streak: STREAK,
    oralExamPasses: 0,
    bestOralExam: null,
    ...overrides,
  };
}

describe('metrics — précision pondérée par ACCURACY_CREDIT', () => {
  it('compte un hard comme un demi-succès', () => {
    const metrics = metricsCalculator.compute(
      metricsInput({ reviewLogs: [log({ grade: 'hard' }), log({ grade: 'good' })] }),
    );
    const direction = metrics.answersByDirection['keyword-to-question'];
    expect(direction.attempts).toBe(2);
    expect(direction.correct).toBe(2);
    expect(direction.accuracy).toBe(0.75);
    expect(direction.averageResponseTimeMs).toBe(3000);
  });

  it('vaut 0 pour again et 1 pour easy', () => {
    const again = metricsCalculator.compute(
      metricsInput({ reviewLogs: [log({ grade: 'again' })] }),
    );
    const easy = metricsCalculator.compute(metricsInput({ reviewLogs: [log({ grade: 'easy' })] }));
    expect(again.answersByDirection['keyword-to-question'].accuracy).toBe(0);
    expect(again.answersByDirection['keyword-to-question'].correct).toBe(0);
    expect(easy.answersByDirection['keyword-to-question'].accuracy).toBe(1);
  });

  it('renvoie des métriques vides mais cohérentes pour chaque direction', () => {
    const metrics = metricsCalculator.compute(metricsInput());
    for (const direction of Object.keys(metrics.answersByDirection) as DrillDirection[]) {
      const value = metrics.answersByDirection[direction];
      expect(value).toEqual({
        attempts: 0,
        correct: 0,
        accuracy: 0,
        averageResponseTimeMs: null,
      });
    }
  });

  it('répartit les tentatives par direction', () => {
    const metrics = metricsCalculator.compute(
      metricsInput({
        reviewLogs: [
          log({ direction: 'order-to-question', responseTimeMs: 1000 }),
          log({ direction: 'order-to-question', responseTimeMs: 3000 }),
          log({ direction: 'question-to-number', responseTimeMs: 5000 }),
        ],
      }),
    );
    expect(metrics.answersByDirection['order-to-question']).toEqual({
      attempts: 2,
      correct: 2,
      accuracy: 1,
      averageResponseTimeMs: 2000,
    });
    expect(metrics.answersByDirection['question-to-number'].attempts).toBe(1);
  });
});

describe('metrics — la discrimination n’est jamais une production', () => {
  it('laisse à zéro toute mesure de production composée uniquement de QCM', () => {
    const qcm = Array.from({ length: 40 }, (_unused, index) =>
      log({
        id: `qcm-${index}`,
        questionId: (index % 36) + 1,
        exerciseKind: 'discrimination',
        direction: 'keyword-to-question',
        grade: 'easy',
        hintsUsed: 0,
        confidence: 5,
        reviewedAt: index * DAY_MS,
      }),
    );
    const metrics = metricsCalculator.compute(
      metricsInput({
        reviewLogs: qcm,
        sessionLogs: [
          session({
            itemCount: 12,
            productionCount: 0,
            discriminationCount: 12,
            correctCount: 12,
          }),
        ],
      }),
    );

    // Le volume total reste visible, mais rien de ce qui prétend mesurer une
    // restitution n’est alimenté par un QCM.
    expect(metrics.totalAnswers).toBe(40);
    expect(metrics.productionAnswers).toBe(0);
    expect(metrics.correctProductionAnswers).toBe(0);
    expect(metrics.distinctQuestionsAnswered).toBe(0);
    expect(metrics.hintFreeAnswers).toBe(0);
    expect(metrics.hintFreeAccuracy).toBeNull();
    expect(metrics.calibrationGap).toBeNull();
    expect(metrics.calibrationAnswers).toBe(0);
    expect(metrics.perfectSessions).toBe(0);
    expect(metrics.bestPerfectSessionItemCount).toBe(0);
    for (const direction of Object.keys(metrics.answersByDirection) as DrillDirection[]) {
      expect(metrics.answersByDirection[direction].attempts).toBe(0);
    }
  });

  it('ignore un QCM dans la précision d’une direction déjà travaillée', () => {
    const metrics = metricsCalculator.compute(
      metricsInput({
        reviewLogs: [
          log({ exerciseKind: 'production', grade: 'good' }),
          log({ exerciseKind: 'discrimination', grade: 'again' }),
          log({ exerciseKind: 'discrimination', grade: 'easy', hintsUsed: 0 }),
        ],
      }),
    );
    const direction = metrics.answersByDirection['keyword-to-question'];
    expect(direction.attempts).toBe(1);
    expect(direction.accuracy).toBe(1);
    expect(metrics.hintFreeAnswers).toBe(1);
    expect(metrics.hintFreeAccuracy).toBe(1);
  });
});

describe('metrics — calibration (L12)', () => {
  it('vaut null sans jugement de confiance', () => {
    expect(
      metricsCalculator.compute(metricsInput({ reviewLogs: [log()] })).calibrationGap,
    ).toBeNull();
    expect(metricsCalculator.compute(metricsInput()).calibrationGap).toBeNull();
  });

  it('mesure l’écart moyen entre confiance et réussite', () => {
    const metrics = metricsCalculator.compute(
      metricsInput({
        reviewLogs: [log({ confidence: 5, grade: 'easy' }), log({ confidence: 1, grade: 'good' })],
      }),
    );
    expect(metrics.calibrationGap).toBeCloseTo(0.4, 10);
    expect(metrics.calibrationAnswers).toBe(2);
  });

  it('ignore les réponses sans confiance dans la moyenne', () => {
    const metrics = metricsCalculator.compute(
      metricsInput({
        reviewLogs: [
          log({ confidence: 5, grade: 'easy' }),
          log({ confidence: null, grade: 'again' }),
        ],
      }),
    );
    expect(metrics.calibrationGap).toBe(0);
    expect(metrics.calibrationAnswers).toBe(1);
  });
});

describe('metrics — cohérence des totaux', () => {
  it('compte les réponses, productions et questions distinctes produites', () => {
    const metrics = metricsCalculator.compute(
      metricsInput({
        reviewLogs: [
          log({ questionId: 1, exerciseKind: 'production', grade: 'good' }),
          log({ questionId: 1, exerciseKind: 'production', grade: 'again' }),
          log({ questionId: 2, exerciseKind: 'discrimination', grade: 'hard' }),
          log({ questionId: 3, exerciseKind: 'production', grade: 'easy', hintsUsed: 2 }),
        ],
      }),
    );
    expect(metrics.totalAnswers).toBe(4);
    expect(metrics.productionAnswers).toBe(3);
    expect(metrics.correctProductionAnswers).toBe(2);
    // Seules les productions comptent : la question 2 n’a été qu’un QCM.
    expect(metrics.distinctQuestionsAnswered).toBe(2);
    expect(metrics.hintFreeAnswers).toBe(2);
    expect(metrics.hintFreeAccuracy).toBeCloseTo((1 + 0) / 2, 10);
  });

  it('compte les questions et les actes maîtrisés depuis la maîtrise', () => {
    const actOne = Array.from({ length: 12 }, (_unused, index) => questionMastery(index + 1, true));
    const partial = [questionMastery(13, true), questionMastery(14, false)];
    const metrics = metricsCalculator.compute(metricsInput({ mastery: [...actOne, ...partial] }));
    expect(metrics.masteredQuestions).toBe(13);
    expect(metrics.masteredActs).toBe(1);
    expect(metrics.masteredActIds).toEqual([1]);
  });

  it('compte un acte maîtrisé seulement s’il est complet', () => {
    const almost = Array.from({ length: 11 }, (_unused, index) => questionMastery(index + 1, true));
    expect(metricsCalculator.compute(metricsInput({ mastery: almost })).masteredActs).toBe(0);
    expect(metricsCalculator.compute(metricsInput({ mastery: almost })).masteredActIds).toEqual([]);
    const all = Array.from({ length: 36 }, (_unused, index) => questionMastery(index + 1, true));
    const metrics = metricsCalculator.compute(metricsInput({ mastery: all }));
    expect(metrics.masteredActs).toBe(3);
    expect(metrics.masteredActIds).toEqual([1, 2, 3]);
  });

  it('expose un ensemble exact d’actes, pas un compteur', () => {
    // Actes I et III maîtrisés, acte II à 11/12 : deux actes maîtrisés, mais
    // l’ensemble ne contient pas 2.
    const mastery = [
      ...Array.from({ length: 12 }, (_unused, index) => questionMastery(index + 1, true)),
      ...Array.from({ length: 11 }, (_unused, index) => questionMastery(13 + index, true)),
      ...Array.from({ length: 12 }, (_unused, index) => questionMastery(25 + index, true)),
    ];
    const metrics = metricsCalculator.compute(metricsInput({ mastery }));
    expect(metrics.masteredActs).toBe(2);
    expect(metrics.masteredActIds).toEqual([1, 3]);
  });

  it('compte les sessions parfaites, du soir et du matin', () => {
    const metrics = metricsCalculator.compute(
      metricsInput({
        sessionLogs: [
          session({ itemCount: 12, productionCount: 12, correctCount: 12, window: 'evening' }),
          session({ itemCount: 4, productionCount: 4, correctCount: 4, window: 'morning' }),
          session({ itemCount: 10, productionCount: 10, correctCount: 9, window: 'day' }),
          session({ itemCount: 6, productionCount: 6, correctCount: 6, window: 'morning' }),
        ],
      }),
    );
    // Seules les sessions d’au moins `PERFECT_SESSION_MIN_ITEMS` items comptent
    // comme « parfaites » ; la taille de la meilleure est exposée à part.
    expect(metrics.perfectSessions).toBe(2);
    expect(metrics.bestPerfectSessionItemCount).toBe(12);
    expect(metrics.eveningSessions).toBe(1);
    expect(metrics.morningSessions).toBe(2);
  });

  it('n’accorde la session parfaite qu’à une session 100 % production', () => {
    const metrics = metricsCalculator.compute(
      metricsInput({
        sessionLogs: [
          session({ itemCount: 12, productionCount: 0, discriminationCount: 12, correctCount: 12 }),
        ],
      }),
    );
    expect(metrics.perfectSessions).toBe(0);
    expect(metrics.bestPerfectSessionItemCount).toBe(0);
  });

  it('mesure le plus grand écart d’activité en jours UTC', () => {
    const metrics = metricsCalculator.compute(
      metricsInput({
        reviewLogs: [
          log({ reviewedAt: 0 }),
          log({ reviewedAt: 3 * DAY_MS }),
          log({ reviewedAt: 4 * DAY_MS }),
          log({ reviewedAt: 4 * DAY_MS + 1000 }),
        ],
      }),
    );
    expect(metrics.longestGapDays).toBe(2);
    expect(metricsCalculator.compute(metricsInput({ reviewLogs: [log()] })).longestGapDays).toBe(0);
  });

  it('recopie les agrégats fournis (série, collection, accroches, oral)', () => {
    const metrics = metricsCalculator.compute(
      metricsInput({
        hooksCount: 5,
        collection: {
          entries: [
            { questionId: 1, rarity: 'common', obtainedAt: 0, masteryTier: 1 },
            { questionId: 13, rarity: 'rare', obtainedAt: 0, masteryTier: 2 },
          ],
        },
        oralExamPasses: 2,
        bestOralExam: { durationMs: 300_000, accuracy: 0.95 },
      }),
    );
    expect(metrics.bestStreakDays).toBe(9);
    expect(metrics.collectionSize).toBe(2);
    expect(metrics.personalHooks).toBe(5);
    expect(metrics.oralExamPasses).toBe(2);
    expect(metrics.bestOralExam).toEqual({ durationMs: 300_000, accuracy: 0.95 });
  });

  it('reste cohérent sur toutes les notes possibles', () => {
    const grades: ReviewGrade[] = ['again', 'hard', 'good', 'easy'];
    const metrics = metricsCalculator.compute(
      metricsInput({ reviewLogs: grades.map((grade) => log({ grade })) }),
    );
    expect(metrics.totalAnswers).toBe(4);
    expect(metrics.productionAnswers).toBe(4);
    expect(metrics.correctProductionAnswers).toBe(3);
    expect(metrics.answersByDirection['keyword-to-question'].accuracy).toBeCloseTo(
      (0 + 0.5 + 1 + 1) / 4,
      10,
    );
  });
});
