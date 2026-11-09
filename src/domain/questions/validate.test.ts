import { describe, expect, it } from 'vitest';

import { MENTAL_FILMS } from '@/domain/memory';
import type { MemoryFilm } from '@/domain/memory';
import { QUESTION_ITEMS, validateDataset } from '@/domain/questions';
import type { DatasetIssueCode, DatasetValidationInput, QuestionItem } from '@/domain/questions';

function withQuestions(questions: readonly QuestionItem[]): DatasetValidationInput {
  return { questions, films: MENTAL_FILMS };
}

function withFilms(films: readonly MemoryFilm[]): DatasetValidationInput {
  return { questions: QUESTION_ITEMS, films };
}

function patchQuestion(index: number, patch: Partial<QuestionItem>): readonly QuestionItem[] {
  return QUESTION_ITEMS.map((question, current) =>
    current === index ? { ...question, ...patch } : question,
  );
}

function patchFilm(index: number, patch: Partial<MemoryFilm>): readonly MemoryFilm[] {
  return MENTAL_FILMS.map((film, current) => (current === index ? { ...film, ...patch } : film));
}

function codes(input: DatasetValidationInput): readonly DatasetIssueCode[] {
  const result = validateDataset(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

const FIRST_QUESTION = QUESTION_ITEMS[0];
if (FIRST_QUESTION === undefined) {
  throw new Error('dataset vide');
}

describe('validateur du dataset', () => {
  it('accepte le dataset livré et renvoie ses métadonnées', () => {
    const result = validateDataset({ questions: QUESTION_ITEMS, films: MENTAL_FILMS });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.metadata.frenchCompleteness).toBe(1);
      expect(result.metadata.translationProvenance.humanReview).toBe('pending');
      expect(result.metadata.translationProvenance.reviewedAt).toBeNull();
    }
  });

  it('ne lève pas sur une entrée vide et liste les manquements', () => {
    const result = validateDataset({ questions: [], films: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain('question-count');
      expect(result.issues.map((issue) => issue.code)).toContain('questions-per-act');
    }
  });

  it('rejette un nombre de questions différent de 36', () => {
    expect(codes(withQuestions(QUESTION_ITEMS.slice(0, 35)))).toContain('question-count');
  });

  it('rejette un identifiant hors bornes', () => {
    expect(codes(withQuestions(patchQuestion(0, { id: 37, order: 37 })))).toContain(
      'id-out-of-range',
    );
    expect(codes(withQuestions(patchQuestion(0, { id: 0, order: 0 })))).toContain(
      'id-out-of-range',
    );
  });

  it('rejette un identifiant dupliqué', () => {
    expect(codes(withQuestions(patchQuestion(1, { id: FIRST_QUESTION.id, order: 1 })))).toContain(
      'duplicate-id',
    );
  });

  it('rejette une incohérence entre identifiant, rang, acte et position', () => {
    expect(codes(withQuestions(patchQuestion(0, { order: 2 })))).toContain('order-mismatch');
    expect(codes(withQuestions(patchQuestion(0, { actId: 2 })))).toContain('act-mismatch');
    expect(codes(withQuestions(patchQuestion(0, { positionInAct: 5 })))).toContain(
      'position-mismatch',
    );
  });

  it('rejette un acte qui ne contient pas 12 questions', () => {
    // La première question de l’acte II est déplacée dans l’acte I.
    const questions = patchQuestion(12, { actId: 1 });
    expect(codes(withQuestions(questions))).toContain('questions-per-act');
  });

  it('rejette un texte français ou anglais vide', () => {
    const noFrench = patchQuestion(0, {
      keyword: { ...FIRST_QUESTION.keyword, fr: '   ' },
    });
    expect(codes(withQuestions(noFrench))).toContain('empty-french');

    const noEnglish = patchQuestion(0, {
      prompt: { fr: FIRST_QUESTION.prompt.fr, en: '' },
    });
    expect(codes(withQuestions(noEnglish))).toContain('empty-english');

    const noImage = patchQuestion(0, {
      mentalImage: { fr: '', en: '   ' },
    });
    const imageCodes = codes(withQuestions(noImage));
    expect(imageCodes).toContain('empty-french');
    expect(imageCodes).toContain('empty-english');
  });

  it('rejette un mot-clé dupliqué', () => {
    const second = QUESTION_ITEMS[1];
    if (second === undefined) throw new Error('dataset incomplet');
    const duplicate = patchQuestion(1, {
      keyword: { ...second.keyword, fr: FIRST_QUESTION.keyword.fr },
    });
    expect(codes(withQuestions(duplicate))).toContain('duplicate-keyword');
  });

  it('rejette deux mots-clés qui partagent un mot lexical significatif', () => {
    // Mots-clés littéralement différents, mais un même mot porteur : un drill
    // mot→question ne peut plus trancher entre les deux questions.
    const second = QUESTION_ITEMS[1];
    if (second === undefined) throw new Error('dataset incomplet');
    const colliding = patchQuestion(1, {
      keyword: { ...second.keyword, fr: 'Journée sans fin' },
    });
    const collisionCodes = codes(withQuestions(colliding));
    expect(collisionCodes).toContain('keyword-collision');
    expect(collisionCodes).not.toContain('duplicate-keyword');
  });

  it('rejette un film manquant ou en double', () => {
    expect(codes(withFilms(MENTAL_FILMS.slice(0, 2)))).toContain('film-missing');
    expect(codes(withFilms(MENTAL_FILMS.slice(0, 2)))).toContain('film-count');
    expect(codes(withFilms([...MENTAL_FILMS, MENTAL_FILMS[0]]))).toContain('film-count');
  });

  it('rejette un film qui ne couvre pas 12 scènes dans l’ordre', () => {
    const firstFilm = MENTAL_FILMS[0];
    if (firstFilm === undefined) throw new Error('film manquant');

    expect(codes(withFilms(patchFilm(0, { scenes: firstFilm.scenes.slice(0, 11) })))).toContain(
      'film-scene-count',
    );

    const firstScene = firstFilm.scenes[0];
    if (firstScene === undefined) throw new Error('scène manquante');
    const reordered = firstFilm.scenes.map((scene, index) =>
      index === 0 ? { ...scene, order: 2 } : scene,
    );
    expect(codes(withFilms(patchFilm(0, { scenes: reordered })))).toContain('film-order-mismatch');

    const wrongQuestion = firstFilm.scenes.map((scene, index) =>
      index === 0 ? { ...scene, questionId: 36 } : scene,
    );
    const wrongCodes = codes(withFilms(patchFilm(0, { scenes: wrongQuestion })));
    expect(wrongCodes).toContain('film-question-mismatch');
    expect(wrongCodes).toContain('film-coverage');
  });

  it('rejette une transition manquante ou une transition sur la dernière scène', () => {
    const firstFilm = MENTAL_FILMS[0];
    if (firstFilm === undefined) throw new Error('film manquant');

    const withoutTransition = firstFilm.scenes.map((scene, index) =>
      index === 0 ? { ...scene, transitionToNext: null } : scene,
    );
    expect(codes(withFilms(patchFilm(0, { scenes: withoutTransition })))).toContain(
      'film-transition-missing',
    );

    const last = firstFilm.scenes.length - 1;
    const withFinalTransition = firstFilm.scenes.map((scene, index) =>
      index === last ? { ...scene, transitionToNext: { fr: 'Suite', en: 'Next' } } : scene,
    );
    expect(codes(withFilms(patchFilm(0, { scenes: withFinalTransition })))).toContain(
      'film-transition-unexpected',
    );
  });

  it('rejette une question illustrée deux fois dans le même film', () => {
    const firstFilm = MENTAL_FILMS[0];
    if (firstFilm === undefined) throw new Error('film manquant');
    const firstScene = firstFilm.scenes[0];
    if (firstScene === undefined) throw new Error('scène manquante');

    const duplicated = firstFilm.scenes.map((scene, index) =>
      index === 1 ? { ...scene, questionId: firstScene.questionId } : scene,
    );
    expect(codes(withFilms(patchFilm(0, { scenes: duplicated })))).toContain(
      'film-duplicate-question',
    );
  });

  it('rejette un titre ou un pitch de film vide', () => {
    expect(codes(withFilms(patchFilm(0, { title: { fr: '', en: '' } })))).toContain('empty-french');
    expect(codes(withFilms(patchFilm(0, { pitch: { fr: 'Pitch', en: '' } })))).toContain(
      'empty-english',
    );
  });
});
