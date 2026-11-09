import { describe, expect, it } from 'vitest';

import {
  HOOK_TEXT_MAX_LENGTH,
  PERSONAL_HOOK_KINDS,
  addHook,
  countHooks,
  createEmptyHookLibrary,
  findHook,
  findHookByKind,
  isValidQuestionId,
  normalizeHookText,
  removeHook,
  replaceHook,
  upsertHook,
} from './hooks';

const T0 = 1_760_000_000_000;
const T1 = T0 + 60_000;

function libraryWithOneHook(): ReturnType<typeof createEmptyHookLibrary> {
  const result = addHook(
    createEmptyHookLibrary(T0),
    { questionId: 7, kind: 'story', text: 'Mon premier entretien d’embauche.' },
    T0,
  );
  if (!result.ok) {
    throw new Error('fixture invalide');
  }
  return result.library;
}

describe('accroches personnelles (L10, L11)', () => {
  it('part d’une bibliothèque vide et expose les trois natures', () => {
    const library = createEmptyHookLibrary(T0);
    expect(library.hooks).toEqual([]);
    expect(library.updatedAt).toBe(T0);
    expect([...PERSONAL_HOOK_KINDS]).toEqual(['keyword', 'story', 'autobiographical']);
  });

  it('ajoute une accroche et renseigne les deux horodatages', () => {
    const library = createEmptyHookLibrary(T0);
    const result = addHook(
      library,
      { questionId: 3, kind: 'keyword', text: '  le   téléphone rouge  ' },
      T0,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hook).toEqual({
      questionId: 3,
      kind: 'keyword',
      text: 'le téléphone rouge',
      createdAt: T0,
      updatedAt: T0,
    });
    expect(result.library.hooks).toHaveLength(1);
    expect(result.library.updatedAt).toBe(T0);
    // Immuabilité : la bibliothèque d’origine n’est pas modifiée.
    expect(library.hooks).toHaveLength(0);
  });

  it('maintient une seule accroche par question, quelle que soit sa nature', () => {
    const library = libraryWithOneHook();
    const duplicate = addHook(
      library,
      { questionId: 7, kind: 'keyword', text: 'Autre nature.' },
      T1,
    );

    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.error.code).toBe('hook-exists');
    expect(duplicate.error.questionId).toBe(7);
    expect(library.hooks).toHaveLength(1);
  });

  it('remplace une accroche en conservant createdAt et en changeant la nature', () => {
    const library = libraryWithOneHook();
    const result = replaceHook(
      library,
      { questionId: 7, kind: 'autobiographical', text: 'Le jour de mon mariage.' },
      T1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hook.createdAt).toBe(T0);
    expect(result.hook.updatedAt).toBe(T1);
    expect(result.hook.kind).toBe('autobiographical');
    expect(result.hook.text).toBe('Le jour de mon mariage.');
    expect(result.library.updatedAt).toBe(T1);
    expect(findHook(result.library, 7)?.text).toBe('Le jour de mon mariage.');
    expect(result.library.hooks).toHaveLength(1);
  });

  it('refuse de remplacer ou de supprimer une accroche absente', () => {
    const library = createEmptyHookLibrary(T0);

    const replaced = replaceHook(library, { questionId: 12, kind: 'story', text: 'Rien ici.' }, T1);
    expect(replaced.ok).toBe(false);
    if (!replaced.ok) expect(replaced.error.code).toBe('hook-not-found');

    const removed = removeHook(library, 12, T1);
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error.code).toBe('hook-not-found');
  });

  it('supprime une accroche existante', () => {
    const library = libraryWithOneHook();
    const result = removeHook(library, 7, T1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.library.hooks).toEqual([]);
    expect(result.library.updatedAt).toBe(T1);
    expect(findHook(result.library, 7)).toBeUndefined();
  });

  it('upsert ajoute puis remplace sans doublon', () => {
    const first = upsertHook(
      createEmptyHookLibrary(T0),
      { questionId: 1, kind: 'story', text: 'Première version.' },
      T0,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = upsertHook(
      first.library,
      { questionId: 1, kind: 'keyword', text: 'Deuxième version.' },
      T1,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.library.hooks).toHaveLength(1);
    expect(second.hook.createdAt).toBe(T0);
    expect(second.hook.updatedAt).toBe(T1);
  });

  it('trie les accroches par identifiant de question', () => {
    let library = createEmptyHookLibrary(T0);
    for (const questionId of [30, 2, 17]) {
      const result = addHook(library, { questionId, kind: 'keyword', text: `Q${questionId}` }, T0);
      if (!result.ok) throw new Error(result.error.message);
      library = result.library;
    }
    expect(library.hooks.map((hook) => hook.questionId)).toEqual([2, 17, 30]);
    expect(countHooks(library)).toBe(3);
    expect(countHooks(library, 'keyword')).toBe(3);
    expect(countHooks(library, 'story')).toBe(0);
  });

  it('retrouve une accroche par question et par nature', () => {
    const library = libraryWithOneHook();
    expect(findHook(library, 7)?.kind).toBe('story');
    expect(findHookByKind(library, 7, 'story')?.questionId).toBe(7);
    expect(findHookByKind(library, 7, 'keyword')).toBeUndefined();
    expect(findHook(library, 8)).toBeUndefined();
  });

  it('rejette un identifiant hors bornes 1..36', () => {
    for (const questionId of [0, -1, 37, 1.5, Number.NaN]) {
      const result = addHook(
        createEmptyHookLibrary(T0),
        { questionId, kind: 'keyword', text: 'Texte.' },
        T0,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid-question-id');
    }
    expect(isValidQuestionId(1)).toBe(true);
    expect(isValidQuestionId(36)).toBe(true);
    expect(isValidQuestionId(37)).toBe(false);
  });

  it('rejette un texte vide ou uniquement composé d’espaces', () => {
    for (const text of ['', '   ', '\n\t ']) {
      const result = addHook(
        createEmptyHookLibrary(T0),
        { questionId: 1, kind: 'keyword', text },
        T0,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('empty-text');
    }
  });

  it('accepte 280 caractères et rejette 281', () => {
    const maxText = 'a'.repeat(HOOK_TEXT_MAX_LENGTH);
    const accepted = addHook(
      createEmptyHookLibrary(T0),
      { questionId: 1, kind: 'keyword', text: maxText },
      T0,
    );
    expect(accepted.ok).toBe(true);

    const rejected = addHook(
      createEmptyHookLibrary(T0),
      { questionId: 1, kind: 'keyword', text: `${maxText}b` },
      T0,
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe('text-too-long');
      expect(rejected.error.maxLength).toBe(HOOK_TEXT_MAX_LENGTH);
    }
  });

  it('rejette un horodatage invalide', () => {
    const result = addHook(
      createEmptyHookLibrary(T0),
      { questionId: 1, kind: 'keyword', text: 'Texte.' },
      -1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-time');
  });

  it('rejette un identifiant ou un horodatage invalide à la suppression', () => {
    const library = libraryWithOneHook();
    expect(removeHook(library, 37, T1)).toMatchObject({
      ok: false,
      error: { code: 'invalid-question-id' },
    });
    expect(removeHook(library, 7, -5)).toMatchObject({
      ok: false,
      error: { code: 'invalid-time' },
    });
  });

  it('normalise les espaces sans toucher au contenu', () => {
    expect(normalizeHookText('  un   deux\n trois  ')).toBe('un deux trois');
  });
});
