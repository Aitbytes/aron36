import { ACCURACY_CREDIT, ACT_COUNT, DAY_MS, QUESTIONS_PER_ACT } from '@/domain/shared/types';
import type { DrillDirection, QuestionId, Ratio, ReviewGrade } from '@/domain/shared/types';
import type { ReviewLog } from '@/domain/srs/types';
import type { DirectionMetrics, MetricsCalculator, MetricsInput, PlayerMetrics } from './types';
import { PERFECT_SESSION_MIN_ITEMS } from './xp';

/**
 * Métriques dérivées des journaux (L12).
 *
 * Anti-objectifs servis par ce module :
 * - **pas de compteur persisté** : tout est recalculé depuis `ReviewLog` et
 *   `SessionLog`, donc aucun chiffre ne peut diverger ni flatter le joueur ;
 * - **pas de punition** : une précision est une moyenne pondérée par
 *   `ACCURACY_CREDIT` (un `hard` vaut un demi-succès), jamais un compteur de
 *   fautes.
 *
 * Anti-objectif L12 : `calibrationGap` est l'écart moyen
 * `|confiance / 5 − crédit|` ; il vaut `null` sans jugement de confiance, pour
 * ne jamais afficher un chiffre inventé.
 */

/** Moyenne d'une liste non vide ; 0 pour une liste vide. */
function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Crédit de réussite d'une note (0 pour `again`, 0.5 pour `hard`). */
function creditOf(grade: ReviewGrade): number {
  return ACCURACY_CREDIT[grade];
}

/** Métriques d'une direction de drill. */
function directionMetrics(logs: readonly ReviewLog[], direction: DrillDirection): DirectionMetrics {
  const own = logs.filter((log) => log.direction === direction);
  const correct = own.filter((log) => log.grade !== 'again').length;
  return {
    attempts: own.length,
    correct,
    accuracy: mean(own.map((log) => creditOf(log.grade))),
    averageResponseTimeMs: own.length === 0 ? null : mean(own.map((log) => log.responseTimeMs)),
  };
}

/**
 * Nombre d'actes dont les 12 questions sont maîtrisées.
 *
 * La source unique des seuils de maîtrise est `mastery` : ce module ne décide
 * jamais ce qu'est « maîtrisé », il compte.
 */
function countMasteredActs(mastery: MetricsInput['mastery']): number {
  const masteredIds = new Set<QuestionId>(
    mastery.filter((question) => question.mastered).map((question) => question.questionId),
  );
  let masteredActs = 0;
  for (let actIndex = 0; actIndex < ACT_COUNT; actIndex += 1) {
    let complete = true;
    for (let position = 1; position <= QUESTIONS_PER_ACT; position += 1) {
      if (!masteredIds.has(actIndex * QUESTIONS_PER_ACT + position)) {
        complete = false;
        break;
      }
    }
    if (complete) {
      masteredActs += 1;
    }
  }
  return masteredActs;
}

/**
 * Plus grand nombre de jours consécutifs sans activité.
 *
 * Les journées sont comptées en UTC (`reviewedAt / DAY_MS`) : le domaine n'a pas
 * d'horloge et ne peut pas connaître le fuseau local. C'est une mesure
 * d'affichage, jamais un seuil de décision pédagogique.
 */
function longestGapDays(logs: readonly ReviewLog[]): number {
  const days = [...new Set(logs.map((log) => Math.floor(log.reviewedAt / DAY_MS)))].sort(
    (left, right) => left - right,
  );
  return days.reduce((longest, current, index) => {
    const previous = days[index - 1];
    if (previous === undefined) {
      return longest;
    }
    return Math.max(longest, current - previous - 1);
  }, 0);
}

/** Écart moyen entre confiance déclarée et réussite réelle, `null` sans donnée. */
function calibrationGap(logs: readonly ReviewLog[]): Ratio | null {
  const rated: { readonly confidence: number; readonly credit: number }[] = [];
  for (const log of logs) {
    if (log.confidence !== null) {
      rated.push({ confidence: log.confidence, credit: creditOf(log.grade) });
    }
  }
  if (rated.length === 0) {
    return null;
  }
  return mean(rated.map((entry) => Math.abs(entry.confidence / 5 - entry.credit)));
}

/**
 * Recalcule toutes les métriques affichées.
 *
 * `MetricsInput.cards` est fourni par le contrat mais n'alimente aucune métrique
 * exposée : `masteredQuestions`/`masteredActs` viennent de `mastery`, source
 * unique des seuils (aucune duplication de critère dans ce module).
 */
function compute(input: MetricsInput): PlayerMetrics {
  const { reviewLogs, sessionLogs, mastery, hooksCount, collection, streak } = input;
  const productionLogs = reviewLogs.filter((log) => log.exerciseKind === 'production');
  const hintFreeLogs = reviewLogs.filter((log) => log.hintsUsed === 0);
  const answersByDirection: Record<DrillDirection, DirectionMetrics> = {
    'order-to-question': directionMetrics(reviewLogs, 'order-to-question'),
    'keyword-to-question': directionMetrics(reviewLogs, 'keyword-to-question'),
    'image-to-question': directionMetrics(reviewLogs, 'image-to-question'),
    'number-to-question': directionMetrics(reviewLogs, 'number-to-question'),
    'question-to-number': directionMetrics(reviewLogs, 'question-to-number'),
  };

  return {
    totalAnswers: reviewLogs.length,
    productionAnswers: productionLogs.length,
    correctProductionAnswers: productionLogs.filter((log) => log.grade !== 'again').length,
    distinctQuestionsAnswered: new Set(reviewLogs.map((log) => log.questionId)).size,
    masteredQuestions: mastery.filter((question) => question.mastered).length,
    masteredActs: countMasteredActs(mastery),
    bestStreakDays: streak.longest,
    perfectSessions: sessionLogs.filter(
      (session) =>
        session.itemCount >= PERFECT_SESSION_MIN_ITEMS &&
        session.correctCount === session.itemCount,
    ).length,
    collectionSize: collection.entries.length,
    personalHooks: hooksCount,
    oralExamPasses: input.oralExamPasses,
    eveningSessions: sessionLogs.filter((session) => session.window === 'evening').length,
    morningSessions: sessionLogs.filter((session) => session.window === 'morning').length,
    hintFreeAnswers: hintFreeLogs.length,
    hintFreeAccuracy: mean(hintFreeLogs.map((log) => creditOf(log.grade))),
    longestGapDays: longestGapDays(reviewLogs),
    answersByDirection,
    calibrationGap: calibrationGap(reviewLogs),
  };
}

/** Calcul de métriques pur : aucune I/O, aucun compteur persisté. */
export const metricsCalculator: MetricsCalculator = { compute };
