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
  significantKeywordWords,
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

  it('garantit des mots-clés sémantiquement discernables (aucun mot lexical partagé)', () => {
    // Le test d’unicité précédent ne couvre que la collision littérale. Deux
    // mots-clés distincts peuvent partager un même mot porteur (« qualité »,
    // « ami »…) et envoyer un drill mot→question vers la mauvaise question.
    const entries = QUESTION_ITEMS.flatMap((question) => [
      { questionId: question.id, keyword: question.keyword.fr },
      { questionId: question.id, keyword: question.keyword.en ?? '' },
    ]).filter((entry) => entry.keyword.trim().length > 0);

    const ownerByWord = new Map<string, { questionId: number; keyword: string }>();
    const collisions: string[] = [];
    for (const entry of entries) {
      for (const word of significantKeywordWords(entry.keyword)) {
        const owner = ownerByWord.get(word);
        if (owner === undefined) {
          ownerByWord.set(word, entry);
        } else if (owner.questionId !== entry.questionId) {
          collisions.push(
            `« ${word} » partagé par Q${String(owner.questionId)} (« ${owner.keyword} ») et Q${String(entry.questionId)} (« ${entry.keyword} »)`,
          );
        }
      }
    }
    expect(collisions).toEqual([]);
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

  it('expose une provenance de traduction explicite, sans auto-déclaration', () => {
    const { metadata } = QUESTION_DATASET;
    expect(metadata.sourceCitation).toContain('Aron');
    expect(metadata.sourceCitation).toContain('1997');
    const provenance = metadata.translationProvenance;
    // La provenance décrit la méthode réellement suivie…
    expect(provenance.method.trim().length).toBeGreaterThan(0);
    expect(provenance.englishSource).toBe(metadata.sourceCitation);
    // …et dit la vérité sur l’état humain, qu’aucun booléen ne peut certifier.
    expect(provenance.humanReview).toBe('pending');
    expect(provenance.reviewedAt).toBeNull();
    expect(provenance.outstandingReview.trim().length).toBeGreaterThan(0);
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
