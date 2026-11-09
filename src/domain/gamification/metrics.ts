import { ACCURACY_CREDIT, ACT_IDS, DAY_MS, QUESTIONS_PER_ACT } from '@/domain/shared/types';
import type { ActId, DrillDirection, QuestionId, Ratio, ReviewGrade } from '@/domain/shared/types';
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
 *   fautes ;
 * - **pas de reconnaissance déguisée en rappel** : toute métrique qui prétend
 *   mesurer une production filtre `exerciseKind === 'production'`. Un QCM ne
 *   produit donc ni précision, ni réponse « sans indice », ni session parfaite.
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

/**
 * Métriques d'une direction de drill.
 *
 * `logs` ne contient que des **productions** (filtre appliqué par `compute`) :
 * la discrimination ne mesure pas la restitution d'une direction.
 */
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
 * Ensemble exact des actes dont les 12 questions sont maîtrisées.
 *
 * La source unique des seuils de maîtrise est `mastery` : ce module ne décide
 * jamais ce qu'est « maîtrisé », il vérifie l'appartenance.
 */
function masteredActIds(mastery: MetricsInput['mastery']): readonly ActId[] {
  const masteredQuestions = new Set<QuestionId>(
    mastery.filter((question) => question.mastered).map((question) => question.questionId),
  );
  const mastered: ActId[] = [];
  for (const actId of ACT_IDS) {
    let complete = true;
    for (let position = 1; position <= QUESTIONS_PER_ACT; position += 1) {
      if (!masteredQuestions.has((actId - 1) * QUESTIONS_PER_ACT + position)) {
        complete = false;
        break;
      }
    }
    if (complete) {
      mastered.push(actId);
    }
  }
  return mastered;
}

/**
 * Une session est parfaite si elle est **entièrement composée de productions**
 * (aucun QCM), sans aucune erreur, et d'au moins
 * `PERFECT_SESSION_MIN_ITEMS` items.
 */
function isPerfectProductionSession(session: MetricsInput['sessionLogs'][number]): boolean {
  return (
    session.itemCount >= PERFECT_SESSION_MIN_ITEMS &&
    session.itemCount > 0 &&
    session.productionCount === session.itemCount &&
    session.discriminationCount === 0 &&
    session.correctCount === session.itemCount
  );
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

/**
 * Écart moyen entre confiance déclarée et réussite réelle, `null` sans donnée.
 *
 * Les journaux reçus sont des productions : un jugement de confiance porte sur
 * une tentative de restitution, pas sur un choix parmi quatre options.
 */
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
 * `masteredQuestions`/`masteredActIds` viennent de `mastery`, source unique des
 * seuils : aucune duplication de critère dans ce module.
 */
function compute(input: MetricsInput): PlayerMetrics {
  const { reviewLogs, sessionLogs, mastery, hooksCount, collection, streak } = input;
  // Filtre de production : aucune métrique de restitution ne lit un QCM.
  const productionLogs = reviewLogs.filter((log) => log.exerciseKind === 'production');
  // Réponses de production sans aucun indice (L9) : la discrimination exclue.
  const hintFreeLogs = productionLogs.filter((log) => log.hintsUsed === 0);
  const perfectSessions = sessionLogs.filter(isPerfectProductionSession);
  const actIds = masteredActIds(mastery);
  const answersByDirection: Record<DrillDirection, DirectionMetrics> = {
    'order-to-question': directionMetrics(productionLogs, 'order-to-question'),
    'keyword-to-question': directionMetrics(productionLogs, 'keyword-to-question'),
    'image-to-question': directionMetrics(productionLogs, 'image-to-question'),
    'number-to-question': directionMetrics(productionLogs, 'number-to-question'),
    'question-to-number': directionMetrics(productionLogs, 'question-to-number'),
  };

  return {
    totalAnswers: reviewLogs.length,
    productionAnswers: productionLogs.length,
    correctProductionAnswers: productionLogs.filter((log) => log.grade !== 'again').length,
    distinctQuestionsAnswered: new Set(productionLogs.map((log) => log.questionId)).size,
    masteredQuestions: mastery.filter((question) => question.mastered).length,
    masteredActs: actIds.length,
    masteredActIds: actIds,
    bestStreakDays: streak.longest,
    perfectSessions: perfectSessions.length,
    bestPerfectSessionItemCount: perfectSessions.reduce(
      (best, session) => Math.max(best, session.itemCount),
      0,
    ),
    collectionSize: collection.entries.length,
    personalHooks: hooksCount,
    oralExamPasses: input.oralExamPasses,
    eveningSessions: sessionLogs.filter((session) => session.window === 'evening').length,
    morningSessions: sessionLogs.filter((session) => session.window === 'morning').length,
    hintFreeAnswers: hintFreeLogs.length,
    hintFreeAccuracy:
      hintFreeLogs.length === 0 ? null : mean(hintFreeLogs.map((log) => creditOf(log.grade))),
    longestGapDays: longestGapDays(reviewLogs),
    answersByDirection,
    calibrationGap: calibrationGap(productionLogs),
    calibrationAnswers: productionLogs.filter((log) => log.confidence !== null).length,
    bestOralExam: input.bestOralExam,
  };
}

/** Calcul de métriques pur : aucune I/O, aucun compteur persisté. */
export const metricsCalculator: MetricsCalculator = { compute };
