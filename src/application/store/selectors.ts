import { levelCalculator, LEVEL_CURVE } from '@/domain/gamification';
import type { LevelState, StreakState } from '@/domain/gamification/types';
import { masteryEvaluator } from '@/domain/mastery';
import { DEFAULT_MASTERY_CRITERIA } from '@/domain/mastery/types';
import { QUESTIONS_PER_ACT } from '@/domain/shared/types';
import type { EpochMs, Ratio } from '@/domain/shared/types';

import type { AppScreen, AppState, FeedbackState } from './types';

/**
 * Sélecteurs purs : `AppState → valeur`, sans effet de bord et sans source de
 * temps (l'instant est toujours un paramètre). Ils ne créent **aucune** vérité
 * métier : toute règle est déléguée au domaine (`LevelCalculator`,
 * `MasteryEvaluator`) ou projetée depuis l'état.
 *
 * Coût : `selectIsGrandOralAvailable` réévalue toute la maîtrise — la Phase 4
 * mémoïsera les sélecteurs (couplée à la référence de `AppState`), comme le
 * permet leur pureté.
 */

/** Avancement de la session courante, projeté pour l'UI. */
export interface SessionProgress {
  /** Index de l'item courant (0-based), `items.length` une fois terminé. */
  readonly index: number;
  readonly total: number;
  /** `index / total`, borné à [0, 1] ; 0 pour une session vide. */
  readonly ratio: Ratio;
}

/**
 * Nombre de cartes dont l'échéance est atteinte (`dueAt <= now`).
 *
 * L'instant est **injecté** : un sélecteur ne peut pas lire l'horloge (ADR
 * 0008). La règle `dueAt <= now` est celle documentée par `Scheduler.isDue` ;
 * elle est recopiée ici plutôt qu'importée pour ne pas ajouter au store une
 * dépendance d'exécution vers `domain/srs` (le diagramme de dépendances
 * n'autorise que session, progress et gamification) — un test d'égalité de
 * contrat l'ancre au domaine.
 */
export function selectDueCount(state: AppState, now: EpochMs): number {
  let due = 0;
  for (const card of Object.values(state.progress.cards)) {
    if (card.dueAt <= now) {
      due += 1;
    }
  }
  return due;
}

/** Niveau et progression dans le niveau, délégués à `LevelCalculator`. */
export function selectLevel(state: AppState): LevelState {
  return levelCalculator.levelFor(state.progress.player.totalXp, LEVEL_CURVE);
}

/** Série quotidienne persistée (projection, aucune dérivation). */
export function selectStreak(state: AppState): StreakState {
  return state.progress.player.streak;
}

/** Avancement de la session courante, ou `null` hors session. */
export function selectSessionProgress(state: AppState): SessionProgress | null {
  const session = state.session;
  if (session === null) {
    return null;
  }
  const total = session.plan.items.length;
  const index = session.currentIndex;
  return {
    index,
    total,
    ratio: total === 0 ? 0 : Math.min(1, Math.max(0, index / total)),
  };
}

/**
 * La révélation est-elle permise pour l'item courant ?
 *
 * `false` hors session, et quand le plan exige un jugement de confiance (L12)
 * non encore déclaré — la barrière de phase restant du ressort de
 * `SessionEngine.revealAnswer` (le sélecteur ne redécide pas la machine à
 * états du domaine).
 */
export function selectCanReveal(state: AppState): boolean {
  const session = state.session;
  if (session === null) {
    return false;
  }
  if (!session.plan.config.requiresConfidence) {
    return true;
  }
  return session.confidence !== null;
}

/**
 * Le Grand Oral (examen final sur les 36 items) est-il ouvert ?
 *
 * La vérité « acte maîtrisé » est déléguée à `MasteryEvaluator` : l'examen est
 * disponible quand **les trois actes** sont entièrement maîtrisés. `now` vaut
 * 0 car `MasteryInput.now` n'alimente que `computedAt`, inutilisé par les
 * critères courants (intervalle, notes de qualité, directions) — à surveiller
 * si les critères évoluaient vers une condition datée.
 */
export function selectIsGrandOralAvailable(state: AppState): boolean {
  const snapshot = masteryEvaluator.evaluate(
    {
      cards: Object.values(state.progress.cards),
      reviewLogs: state.progress.reviewLogs,
      questionsPerAct: QUESTIONS_PER_ACT,
      now: 0,
    },
    DEFAULT_MASTERY_CRITERIA,
  );
  return snapshot.acts.every((act) => act.masteredCount === act.questionCount);
}

/** Écran racine affiché. */
export function selectActiveScreen(state: AppState): AppScreen {
  return state.ui.screen;
}

/** Feedback courant (réponse + correction), ou `null` avant révélation. */
export function selectFeedback(state: AppState): FeedbackState | null {
  return state.ui.feedback;
}
