import { MENTAL_FILMS } from '@/domain/memory/films';
import type { MemoryFilm } from '@/domain/memory/types';
import { QUESTIONS_PER_ACT } from '@/domain/shared/types';
import type { ActId, QuestionId } from '@/domain/shared/types';

import { ACT_CONTENTS, QUESTION_ITEMS, buildDatasetMetadata } from './data';
import type { Act, DatasetMetadata, QuestionCatalog, QuestionDataset, QuestionItem } from './types';

/**
 * Construction du catalogue à partir du dataset statique.
 *
 * Toutes les fonctions sont **pures et déterministes** : même entrée ⇒ même
 * sortie. Les index `byId` et `byKeyword` sont construits une seule fois au
 * chargement du module (`QUESTION_CATALOG`), puis partagés en lecture seule.
 */

/** Acte attendu pour un rang global donné : `⌊(order − 1) / 12⌋ + 1`. */
export function expectedActIdForOrder(order: number): number {
  return Math.floor((order - 1) / QUESTIONS_PER_ACT) + 1;
}

/** Position attendue dans l’acte pour un rang global : `((order − 1) mod 12) + 1`. */
export function expectedPositionForOrder(order: number): number {
  return ((order - 1) % QUESTIONS_PER_ACT) + 1;
}

/**
 * Normalise un mot-clé pour l’index inverse : minuscules, sans diacritiques,
 * espaces multiples réduits. « Célébrité » et « celebrite » donnent la même clé.
 */
export function normalizeKeyword(keyword: string): string {
  return keyword
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, ' ');
}

function buildActs(films: readonly MemoryFilm[]): readonly Act[] {
  const filmsByAct = new Map<ActId, MemoryFilm>();
  for (const film of films) {
    filmsByAct.set(film.actId, film);
  }
  return ACT_CONTENTS.map((content) => {
    const film = filmsByAct.get(content.id);
    if (film === undefined) {
      // Erreur de programmation : les trois actes doivent avoir leur film.
      throw new Error(`Film mental manquant pour l’acte ${String(content.id)}.`);
    }
    return { id: content.id, order: content.order, title: content.title, film };
  });
}

function buildIdIndex(questions: readonly QuestionItem[]): ReadonlyMap<QuestionId, QuestionItem> {
  const index = new Map<QuestionId, QuestionItem>();
  for (const question of questions) {
    if (!index.has(question.id)) {
      index.set(question.id, question);
    }
  }
  return index;
}

/**
 * Index inverse mot-clé → question. Les mots-clés français **et** anglais sont
 * indexés : les drills peuvent chercher dans l’une ou l’autre langue.
 */
function buildKeywordIndex(questions: readonly QuestionItem[]): ReadonlyMap<string, QuestionItem> {
  const index = new Map<string, QuestionItem>();
  for (const question of questions) {
    for (const keyword of [question.keyword.fr, question.keyword.en]) {
      if (keyword === undefined || keyword.length === 0) {
        continue;
      }
      const key = normalizeKeyword(keyword);
      if (!index.has(key)) {
        index.set(key, question);
      }
    }
  }
  return index;
}

/** Assemble un catalogue à partir de questions et de films. */
export function buildQuestionCatalog(
  questions: readonly QuestionItem[],
  films: readonly MemoryFilm[],
): QuestionCatalog {
  return {
    questions: [...questions],
    acts: buildActs(films),
    byId: buildIdIndex(questions),
    byKeyword: buildKeywordIndex(questions),
  };
}

/** Catalogue livré, construit depuis le dataset statique. */
export const QUESTION_CATALOG: QuestionCatalog = buildQuestionCatalog(QUESTION_ITEMS, MENTAL_FILMS);

/** Métadonnées de provenance du dataset livré. */
export const QUESTION_METADATA: DatasetMetadata = buildDatasetMetadata(QUESTION_ITEMS);

/** Dataset complet (catalogue + métadonnées) exposé aux couches supérieures. */
export const QUESTION_DATASET: QuestionDataset = {
  catalog: QUESTION_CATALOG,
  metadata: QUESTION_METADATA,
};

/** Question par identifiant, `undefined` si absente. */
export function getQuestionById(
  catalog: QuestionCatalog,
  id: QuestionId,
): QuestionItem | undefined {
  return catalog.byId.get(id);
}

/** Questions d’un acte, dans l’ordre des positions. */
export function getQuestionsByAct(catalog: QuestionCatalog, actId: ActId): readonly QuestionItem[] {
  return catalog.questions.filter((question) => question.actId === actId);
}

/** Question par mot-clé (français ou anglais), `undefined` si absent. */
export function getQuestionByKeyword(
  catalog: QuestionCatalog,
  keyword: string,
): QuestionItem | undefined {
  return catalog.byKeyword.get(normalizeKeyword(keyword));
}

/** Acte par identifiant, `undefined` si absent. */
export function getAct(catalog: QuestionCatalog, actId: ActId): Act | undefined {
  return catalog.acts.find((act) => act.id === actId);
}
