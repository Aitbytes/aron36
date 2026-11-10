import { ACCURACY_CREDIT } from '@/domain/shared/types';
import type { EpochMs, Ratio } from '@/domain/shared/types';
import type { SessionSummary } from '@/domain/session/types';
import type { SessionState } from '@/domain/session/types';

/**
 * Agrégats d'une session (`SessionSummary`, `SessionLog`).
 *
 * Convention de comptage, alignée sur le contrat du moteur (L18) :
 * - `answeredCount` compte **toutes** les réponses du moteur (une devinette de
 *   prétest est une réponse) ;
 * - `correctCount`, `accuracy`, `productionCount`, `discriminationCount`,
 *   `spokenCount` et `byDirection` ne comptent que les réponses **notées**
 *   (hors prétest, jamais corrigée ni journalisée) ;
 * - `accuracy` pondère chaque note par `ACCURACY_CREDIT` (un `hard` vaut un
 *   demi-succès) — c'est la définition de précision unique du projet ;
 * - `xpAwarded` est fourni par l'appelant : la somme des XP de **production**
 *   de la session (les QCM et les bonus de fin de session n'y entrent pas).
 */

/** Dénombrement partagé du résumé d'écran et du journal persisté. */
export interface SessionTally {
  readonly itemCount: number;
  readonly answeredCount: number;
  readonly productionCount: number;
  readonly discriminationCount: number;
  readonly spokenCount: number;
  readonly correctCount: number;
  readonly accuracy: Ratio;
  readonly byDirection: SessionSummary['byDirection'];
}

/** Compte les réponses notées de la session, direction par direction. */
export function tallySession(state: SessionState): SessionTally {
  const graded = state.answers.filter((answer) => !answer.isPretest);
  const byDirection: {
    -readonly [D in keyof SessionSummary['byDirection']]: {
      attempts: number;
      correct: number;
    };
  } = {
    'order-to-question': { attempts: 0, correct: 0 },
    'keyword-to-question': { attempts: 0, correct: 0 },
    'image-to-question': { attempts: 0, correct: 0 },
    'number-to-question': { attempts: 0, correct: 0 },
    'question-to-number': { attempts: 0, correct: 0 },
  };
  let creditSum = 0;
  let spokenCount = 0;
  for (const answer of graded) {
    const bucket = byDirection[answer.direction];
    if (bucket === undefined) {
      continue;
    }
    bucket.attempts += 1;
    if (answer.isCorrect) {
      bucket.correct += 1;
    }
    creditSum += ACCURACY_CREDIT[answer.grade];
    // L8 : une production « déclarée à l'oral » couvre la lecture effective
    // (`spoken`) comme l'auto-déclaration honnête (`self-declared`).
    if (answer.exerciseKind === 'production' && answer.channel !== 'written') {
      spokenCount += 1;
    }
  }
  const accuracy: Ratio = graded.length === 0 ? 0 : creditSum / graded.length;
  return {
    itemCount: state.plan.items.length,
    answeredCount: state.answers.length,
    productionCount: graded.filter((answer) => answer.exerciseKind === 'production').length,
    discriminationCount: graded.filter((answer) => answer.exerciseKind === 'discrimination').length,
    spokenCount,
    correctCount: graded.filter((answer) => answer.isCorrect).length,
    accuracy,
    byDirection,
  };
}

/** Résumé affichable d'une session, à l'instant `endedAt`. */
export function buildSessionSummary(
  state: SessionState,
  endedAt: EpochMs,
  productionXpAwarded: number,
): SessionSummary {
  const tally = tallySession(state);
  return {
    sessionId: state.plan.id,
    mode: state.plan.mode,
    itemCount: tally.itemCount,
    answeredCount: tally.answeredCount,
    correctCount: tally.correctCount,
    accuracy: tally.accuracy,
    durationMs: endedAt - state.startedAt,
    xpAwarded: productionXpAwarded,
    byDirection: tally.byDirection,
  };
}
