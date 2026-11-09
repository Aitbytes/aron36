import { describe, expect, it } from 'vitest';

import { MENTAL_FILMS } from '@/domain/memory';
import {
  ACT_CONTENTS,
  QUESTION_CATALOG,
  QUESTION_DATASET,
  QUESTION_ITEMS,
  expectedActIdForOrder,
  expectedPositionForOrder,
  getAct,
  getQuestionById,
  getQuestionByKeyword,
  getQuestionsByAct,
  normalizeKeyword,
  validateDataset,
} from '@/domain/questions';
import { ACT_IDS, QUESTION_COUNT, QUESTIONS_PER_ACT } from '@/domain/shared/types';

describe('dataset des 36 questions', () => {
  it('contient exactement 36 questions, identifiées 1..36 sans trou ni doublon', () => {
    expect(QUESTION_ITEMS).toHaveLength(QUESTION_COUNT);
    expect(QUESTION_ITEMS.map((question) => question.id)).toEqual(
      Array.from({ length: QUESTION_COUNT }, (_unused, index) => index + 1),
    );
    expect(QUESTION_CATALOG.byId.size).toBe(QUESTION_COUNT);
  });

  it('forme 3 actes de 12 questions, dans l’ordre des positions', () => {
    expect(QUESTION_CATALOG.acts).toHaveLength(ACT_IDS.length);
    expect(ACT_CONTENTS).toHaveLength(ACT_IDS.length);

    for (const actId of ACT_IDS) {
      const questions = getQuestionsByAct(QUESTION_CATALOG, actId);
      expect(questions).toHaveLength(QUESTIONS_PER_ACT);
      expect(questions.map((question) => question.positionInAct)).toEqual(
        Array.from({ length: QUESTIONS_PER_ACT }, (_unused, index) => index + 1),
      );
    }
  });

  it('dérive acte, position et rang de l’identifiant (id === order)', () => {
    for (const question of QUESTION_ITEMS) {
      expect(question.order).toBe(question.id);
      expect(question.actId).toBe(expectedActIdForOrder(question.order));
      expect(question.positionInAct).toBe(expectedPositionForOrder(question.order));
    }
  });

  it('fournit un mot-clé, une question et une image mentale en français ET en anglais', () => {
    for (const question of QUESTION_ITEMS) {
      for (const [field, value] of [
        ['keyword', question.keyword],
        ['prompt', question.prompt],
        ['mentalImage', question.mentalImage],
      ] as const) {
        expect(value.fr.trim().length, `${field}.fr de Q${question.id}`).toBeGreaterThan(0);
        expect(value.en?.trim().length ?? 0, `${field}.en de Q${question.id}`).toBeGreaterThan(0);
      }
      expect(question.themeTags.length).toBeGreaterThan(0);
    }
  });

  it('garantit des mots-clés uniques (français et anglais, normalisés)', () => {
    // Un même mot-clé peut désigner la même question dans les deux langues
    // (« Gratitude ») ; il ne doit jamais renvoyer à deux questions distinctes.
    const keywordOwner = new Map<string, number>();
    for (const question of QUESTION_ITEMS) {
      for (const keyword of [question.keyword.fr, question.keyword.en]) {
        if (keyword === undefined) continue;
        const key = normalizeKeyword(keyword);
        const owner = keywordOwner.get(key);
        if (owner !== undefined) {
          expect(owner).toBe(question.id);
        } else {
          keywordOwner.set(key, question.id);
        }
      }
    }
    expect(keywordOwner.size).toBeGreaterThanOrEqual(QUESTION_COUNT);
  });

  it('indexe chaque question par identifiant et par mot-clé, dans les deux langues', () => {
    for (const question of QUESTION_ITEMS) {
      expect(getQuestionById(QUESTION_CATALOG, question.id)).toBe(question);
      expect(getQuestionByKeyword(QUESTION_CATALOG, question.keyword.fr)).toBe(question);
      expect(getQuestionByKeyword(QUESTION_CATALOG, question.keyword.en ?? '')).toBe(question);
      // Insensible à la casse et aux diacritiques.
      expect(getQuestionByKeyword(QUESTION_CATALOG, question.keyword.fr.toUpperCase())).toBe(
        question,
      );
    }
    expect(getQuestionById(QUESTION_CATALOG, 0)).toBeUndefined();
    expect(getQuestionById(QUESTION_CATALOG, 37)).toBeUndefined();
    expect(getQuestionByKeyword(QUESTION_CATALOG, 'mot-clé inexistant')).toBeUndefined();
  });

  it('associe à chaque acte son film mental', () => {
    for (const actId of ACT_IDS) {
      const act = getAct(QUESTION_CATALOG, actId);
      expect(act).toBeDefined();
      expect(act?.film.actId).toBe(actId);
      expect(act?.film.scenes).toHaveLength(QUESTIONS_PER_ACT);
    }
    expect(QUESTION_CATALOG.acts.map((act) => act.film)).toEqual([...MENTAL_FILMS]);
  });

  it('expose des métadonnées de provenance complètes et vérifiées', () => {
    const { metadata } = QUESTION_DATASET;
    expect(metadata.sourceCitation).toContain('Aron');
    expect(metadata.sourceCitation).toContain('1997');
    expect(metadata.frenchTranslationVerified).toBe(true);
    expect(metadata.contentVersion).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(metadata.frenchCompleteness).toBe(1);
  });

  it('passe son propre validateur sans aucun manquement', () => {
    const result = validateDataset({ questions: QUESTION_ITEMS, films: MENTAL_FILMS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metadata.frenchCompleteness).toBe(1);
    }
  });
});
