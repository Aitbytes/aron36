import { describe, expect, it } from 'vitest';

import type { DrillDirection } from '@/domain/shared/types';

import { buildSession } from './builder';
import type { SessionItem, SessionPlan } from './types';
import { makeCatalog, makeContext, makeRequest } from './test-fixtures';

function buildPlan(): SessionPlan {
  const result = buildSession(makeRequest({ mode: 'learning', maxItems: 12 }), makeContext());
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('plan attendu');
  }
  return result.plan;
}

function buildExamPlan(): SessionPlan {
  const result = buildSession(makeRequest({ mode: 'grand-oral' }), makeContext());
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('plan d’examen attendu');
  }
  return result.plan;
}

function findItem(plan: SessionPlan, direction: DrillDirection): SessionItem {
  const item = plan.items.find((candidate) => candidate.direction === direction);
  if (item === undefined) {
    throw new Error(`direction absente : ${direction}`);
  }
  return item;
}

describe('directions — les cinq indices de L16', () => {
  const plan = buildPlan();

  it('représente les cinq directions sur une session de 12 items', () => {
    const directions = new Set(plan.items.map((item) => item.direction));
    expect(directions).toEqual(
      new Set<DrillDirection>([
        'order-to-question',
        'keyword-to-question',
        'image-to-question',
        'number-to-question',
        'question-to-number',
      ]),
    );
    expect(plan.interleaving.directionCounts['order-to-question']).toBeGreaterThan(0);
    for (const item of plan.items) {
      expect(item.exerciseKind).toBe('production');
    }
  });

  it('order-to-question : acte + position → texte de la question', () => {
    const item = findItem(plan, 'order-to-question');
    const question = makeCatalog().byId.get(item.questionId);
    expect(item.cue.kind).toBe('order');
    if (item.cue.kind === 'order') {
      expect(item.cue.actId).toBe(item.actId);
      expect(item.cue.positionInAct).toBe(question?.positionInAct);
    }
    expect(item.expectedAnswer.kind).toBe('question');
    if (item.expectedAnswer.kind === 'question') {
      expect(item.expectedAnswer.text).toEqual(question?.prompt);
    }
  });

  it('keyword-to-question : mot-clé → texte de la question', () => {
    const item = findItem(plan, 'keyword-to-question');
    const question = makeCatalog().byId.get(item.questionId);
    expect(item.cue.kind).toBe('keyword');
    if (item.cue.kind === 'keyword') {
      expect(item.cue.text).toEqual(question?.keyword);
    }
    expect(item.expectedAnswer.kind).toBe('question');
  });

  it('image-to-question : image mentale → texte de la question', () => {
    const item = findItem(plan, 'image-to-question');
    const question = makeCatalog().byId.get(item.questionId);
    expect(item.cue.kind).toBe('image');
    if (item.cue.kind === 'image') {
      expect(item.cue.text).toEqual(question?.mentalImage);
    }
    expect(item.expectedAnswer.kind).toBe('question');
  });

  it('number-to-question : numéro global → texte de la question', () => {
    const item = findItem(plan, 'number-to-question');
    expect(item.cue.kind).toBe('number');
    if (item.cue.kind === 'number') {
      expect(item.cue.questionNumber).toBe(item.questionId);
    }
    expect(item.expectedAnswer.kind).toBe('question');
  });

  it('les cinq directions restent représentées en mode examen, sans QCM (L1)', () => {
    const exam = buildExamPlan();
    expect(exam.items).toHaveLength(36);
    expect(exam.config.productionOnly).toBe(true);
    expect(exam.interleaving.discriminationCount).toBe(0);
    const directions = new Set(exam.items.map((item) => item.direction));
    expect(directions.size).toBe(5);
    for (const item of exam.items) {
      expect(item.exerciseKind).toBe('production');
      expect(item.hints).toEqual([]);
    }
  });

  it('question-to-number : texte → numéro global (seule direction inversée)', () => {
    const item = findItem(plan, 'question-to-number');
    const question = makeCatalog().byId.get(item.questionId);
    expect(item.cue.kind).toBe('question');
    if (item.cue.kind === 'question') {
      expect(item.cue.text).toEqual(question?.prompt);
    }
    expect(item.expectedAnswer.kind).toBe('number');
    if (item.expectedAnswer.kind === 'number') {
      expect(item.expectedAnswer.questionNumber).toBe(item.questionId);
    }
  });
});
