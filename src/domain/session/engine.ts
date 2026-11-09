import { CORRECT_GRADES } from '@/domain/shared/types';
import type { EpochMs, ReviewGrade } from '@/domain/shared/types';

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
} from './types';

/**
 * Machine à états d'une session (L1, L9, L12, L13).
 *
 * Transitions autorisées : `asking → revealed → completed`.
 * Chaque transition renvoie un **nouvel** état : l'état d'entrée n'est jamais
 * muté. Le domaine ne note pas, n'ordonnance pas et ne calcule pas d'XP : il
 * produit une `SessionAnswer` normalisée et un feedback correctif.
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
  input: SessionAnswerInput,
): ErrorSignal {
  if (!isCorrectGrade(grade)) {
    if (input.responseTimeMs <= 0) {
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

function revealAnswer(state: SessionState): SessionState {
  if (state.phase !== 'asking') {
    return state;
  }
  return { ...state, phase: 'revealed' };
}

function submitAnswer(state: SessionState, input: SessionAnswerInput): SessionSubmissionResult {
  if (state.phase === 'completed') {
    return { ok: false, failure: 'session-completed' };
  }
  if (state.phase !== 'revealed') {
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
  const confidence = state.plan.config.requiresConfidence
    ? (input.confidence ?? state.confidence)
    : null;
  const answer: SessionAnswer = {
    itemId: item.id,
    questionId: item.questionId,
    direction: item.direction,
    exerciseKind: item.exerciseKind,
    grade: input.grade,
    confidence,
    responseTimeMs: input.responseTimeMs,
    hintsUsed: input.hintsUsed,
    channel: input.channel,
    answeredAt: input.now,
    isCorrect: correct,
  };

  const errorSignal = deduceErrorSignal(item, input.grade, input);
  const feedback: AnswerFeedback = {
    correct,
    expectedAnswer: item.expectedAnswer,
    mentalImage: item.mentalImage,
    errorSignal,
    messageKey: FEEDBACK_MESSAGE_KEYS[errorSignal],
  };

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

/** Implémentation par défaut, sans état, de la machine à états de session. */
export const sessionEngine: SessionEngine = {
  start,
  revealNextHint,
  revealAnswer,
  submitAnswer,
};

export { start, revealNextHint, revealAnswer, submitAnswer };
