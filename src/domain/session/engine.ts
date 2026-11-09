import { CORRECT_GRADES } from '@/domain/shared/types';
import type { ConfidenceRating, EpochMs, ReviewGrade } from '@/domain/shared/types';

import type {
  AnswerFeedback,
  ErrorSignal,
  SessionAnswer,
  SessionAnswerInput,
  SessionEngine,
  SessionItem,
  SessionPlan,
  SessionState,
  SessionSubmissionResult,
  SessionTransitionResult,
} from './types';

/**
 * Machine à états d'une session (L1, L9, L12, L13, L18).
 *
 * Transitions autorisées : `asking → revealed → completed`.
 * Chaque transition renvoie un **nouvel** état : l'état d'entrée n'est jamais
 * muté. Le domaine ne note pas, n'ordonnance pas et ne calcule pas d'XP : il
 * produit une `SessionAnswer` normalisée et un feedback correctif.
 *
 * La confiance (L12) est jugée **avant** la révélation : `setConfidence` la
 * dépose dans l'état, `revealAnswer` l'exige quand `requiresConfidence` est
 * vrai, et `submitAnswer` la recopie dans la réponse. Un prétest (L18) ne
 * produit aucun feedback de correction.
 */

/** Cles i18n stables, une par `ErrorSignal` (L13). */
const FEEDBACK_MESSAGE_KEYS: Readonly<Record<ErrorSignal, string>> = {
  none: 'session.feedback.correct',
  'partial-answer': 'session.feedback.partial',
  'wrong-question': 'session.feedback.wrongQuestion',
  'number-confusion': 'session.feedback.numberConfusion',
  'keyword-confusion': 'session.feedback.keywordConfusion',
  omission: 'session.feedback.omission',
};

function isCorrectGrade(grade: ReviewGrade): boolean {
  return CORRECT_GRADES.some((correct) => correct === grade);
}

/**
 * Déduit un signal d'erreur à partir de la note, de la direction et du temps.
 *
 * Le domaine ne reçoit pas le texte produit par l'apprenant : le signal reste
 * donc une catégorie pédagogique approximative, suffisante pour le feedback.
 */
function deduceErrorSignal(
  item: SessionItem,
  grade: ReviewGrade,
  responseTimeMs: number,
): ErrorSignal {
  if (!isCorrectGrade(grade)) {
    if (responseTimeMs <= 0) {
      return 'omission';
    }
    if (item.direction === 'question-to-number') {
      return 'number-confusion';
    }
    if (item.direction === 'keyword-to-question') {
      return 'keyword-confusion';
    }
    return 'wrong-question';
  }
  return grade === 'hard' ? 'partial-answer' : 'none';
}

function start(plan: SessionPlan, now: EpochMs): SessionState {
  const isEmpty = plan.items.length === 0;
  return {
    plan,
    phase: isEmpty ? 'completed' : 'asking',
    currentIndex: 0,
    answers: [],
    revealedHints: 0,
    confidence: null,
    startedAt: now,
    completedAt: isEmpty ? now : null,
  };
}

function revealNextHint(state: SessionState): SessionState {
  if (state.phase !== 'asking') {
    return state;
  }
  const item = state.plan.items[state.currentIndex];
  if (item === undefined || state.revealedHints >= item.hints.length) {
    return state;
  }
  return { ...state, revealedHints: state.revealedHints + 1 };
}

function revealAnswer(state: SessionState): SessionTransitionResult {
  if (state.phase !== 'asking') {
    return { ok: false, failure: 'wrong-phase' };
  }
  if (state.plan.config.requiresConfidence && state.confidence === null) {
    return { ok: false, failure: 'confidence-required' };
  }
  return { ok: true, state: { ...state, phase: 'revealed' } };
}

function setConfidence(state: SessionState, rating: ConfidenceRating): SessionTransitionResult {
  if (state.phase !== 'asking') {
    return { ok: false, failure: 'wrong-phase' };
  }
  return { ok: true, state: { ...state, confidence: rating } };
}

function submitAnswer(state: SessionState, input: SessionAnswerInput): SessionSubmissionResult {
  if (state.phase === 'completed') {
    return { ok: false, failure: 'session-completed' };
  }
  if (state.phase !== 'revealed') {
    return { ok: false, failure: 'wrong-phase' };
  }
  const requiresConfidence = state.plan.config.requiresConfidence;
  if (requiresConfidence && state.confidence === null) {
    return { ok: false, failure: 'wrong-phase' };
  }
  if (state.answers.some((answer) => answer.itemId === input.itemId)) {
    return { ok: false, failure: 'item-already-answered' };
  }
  const item = state.plan.items[state.currentIndex];
  if (item === undefined || item.id !== input.itemId) {
    return { ok: false, failure: 'unknown-item' };
  }

  const correct = isCorrectGrade(input.grade);
  const confidence = requiresConfidence ? state.confidence : null;
  const answer: SessionAnswer = {
    itemId: item.id,
    questionId: item.questionId,
    direction: item.direction,
    exerciseKind: item.exerciseKind,
    grade: input.grade,
    confidence,
    isPretest: item.isPretest,
    responseTimeMs: input.responseTimeMs,
    hintsUsed: input.hintsUsed,
    channel: input.channel,
    answeredAt: input.now,
    isCorrect: correct,
  };

  // L18 : une devinette de prétest n'est pas corrigée ; la tentative graduée est
  // l'item suivant. Le moteur n'émet donc aucun feedback pour elle.
  const feedback = item.isPretest
    ? null
    : buildFeedback(item, input.grade, correct, input.responseTimeMs);

  const nextIndex = state.currentIndex + 1;
  const completed = nextIndex >= state.plan.items.length;
  const nextState: SessionState = {
    ...state,
    phase: completed ? 'completed' : 'asking',
    currentIndex: completed ? state.plan.items.length : nextIndex,
    answers: [...state.answers, answer],
    revealedHints: 0,
    confidence: null,
    completedAt: completed ? input.now : null,
  };

  return { ok: true, submission: { state: nextState, answer, feedback, completed } };
}

/** Feedback correctif complet d'un item gradué (L13). */
function buildFeedback(
  item: SessionItem,
  grade: ReviewGrade,
  correct: boolean,
  responseTimeMs: number,
): AnswerFeedback {
  const errorSignal = deduceErrorSignal(item, grade, responseTimeMs);
  return {
    correct,
    expectedAnswer: item.expectedAnswer,
    mentalImage: item.mentalImage,
    errorSignal,
    messageKey: FEEDBACK_MESSAGE_KEYS[errorSignal],
  };
}

/** Implémentation par défaut, sans état, de la machine à états de session. */
export const sessionEngine: SessionEngine = {
  start,
  revealNextHint,
  setConfidence,
  revealAnswer,
  submitAnswer,
};

export { start, revealNextHint, setConfidence, revealAnswer, submitAnswer };
