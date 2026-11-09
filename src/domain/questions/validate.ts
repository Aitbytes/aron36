import type { MemoryFilm } from '@/domain/memory/types';
import {
  ACT_COUNT,
  ACT_IDS,
  NUMERIC_BOUNDS,
  QUESTION_COUNT,
  QUESTIONS_PER_ACT,
} from '@/domain/shared/types';
import type { ActId, LocalizedText } from '@/domain/shared/types';

import { normalizeKeyword } from './catalog';
import { buildDatasetMetadata } from './data';
import type { DatasetMetadata, QuestionItem } from './types';

/**
 * Validation pure du contenu.
 *
 * Le validateur **ne lève jamais** : il renvoie soit `{ ok: true }` avec les
 * métadonnées dérivées, soit `{ ok: false }` avec la liste exhaustive des
 * manquements. Il est utilisé par les tests du dataset (Phase 2) et par
 * l’import de contenu (Phase 3), où toute donnée non fiable doit être rejetée.
 */

/** Codes stables des manquements, utilisables par l’UI et les tests. */
export type DatasetIssueCode =
  | 'question-count'
  | 'act-count'
  | 'duplicate-id'
  | 'id-out-of-range'
  | 'order-mismatch'
  | 'act-mismatch'
  | 'position-mismatch'
  | 'questions-per-act'
  | 'empty-french'
  | 'empty-english'
  | 'duplicate-keyword'
  | 'keyword-collision'
  | 'film-count'
  | 'film-missing'
  | 'film-scene-count'
  | 'film-order-mismatch'
  | 'film-question-mismatch'
  | 'film-duplicate-question'
  | 'film-transition-missing'
  | 'film-transition-unexpected'
  | 'film-coverage';

/** Un manquement identifié, localisé par question et/ou acte. */
export interface DatasetIssue {
  readonly code: DatasetIssueCode;
  readonly message: string;
  readonly questionId?: number;
  readonly actId?: ActId;
  /** Champ fautif, ex. `keyword.fr`. */
  readonly field?: string;
}

/** Entrée de la validation : questions et films. */
export interface DatasetValidationInput {
  readonly questions: readonly QuestionItem[];
  readonly films: readonly MemoryFilm[];
}

/** Résultat explicite : succès avec métadonnées, ou échec avec la liste des manquements. */
export type DatasetValidationResult =
  | { readonly ok: true; readonly metadata: DatasetMetadata }
  | { readonly ok: false; readonly issues: readonly DatasetIssue[] };

function isNonEmpty(text: string | undefined): text is string {
  return text !== undefined && text.trim().length > 0;
}

/**
 * Mots vides ignorés lors de la mesure de discriminabilité : ils n’orientent
 * aucune question (articles, prépositions, pronoms, auxiliaires).
 */
const KEYWORD_STOPWORDS: ReadonlySet<string> = new Set([
  // Français
  'le',
  'la',
  'les',
  'un',
  'une',
  'des',
  'du',
  'de',
  'et',
  'ou',
  'au',
  'aux',
  'en',
  'dans',
  'sur',
  'pour',
  'par',
  'avec',
  'sans',
  'vers',
  'se',
  'sa',
  'son',
  'ses',
  'ce',
  'cet',
  'cette',
  'ces',
  'mon',
  'ma',
  'mes',
  'ton',
  'ta',
  'tes',
  'notre',
  'nos',
  'votre',
  'vos',
  'leur',
  'leurs',
  'il',
  'elle',
  'ils',
  'elles',
  'je',
  'tu',
  'on',
  'nous',
  'vous',
  'me',
  'te',
  'lui',
  'que',
  'qui',
  'quoi',
  'dont',
  'ne',
  'pas',
  'plus',
  'an',
  'ans',
  // Anglais
  'the',
  'of',
  'to',
  'in',
  'on',
  'and',
  'or',
  'for',
  'with',
  'your',
  'you',
  'an',
  'as',
  'at',
  'by',
  'is',
  'it',
  'its',
  'that',
  'this',
  'be',
  'are',
  'was',
  'were',
  'my',
  'our',
  'their',
  'they',
  'we',
  'he',
  'she',
  'his',
  'her',
  'from',
  'but',
  'not',
  'no',
  'so',
  'any',
  'one',
]);

/**
 * Mots lexicaux d’un mot-clé, normalisés : ceux qui portent réellement
 * l’accroche. Deux mots-clés qui en partagent un sont jugés indiscernables en
 * drill mot→question.
 *
 * `normalizeKeyword` retire la casse et les diacritiques ; on découpe ensuite
 * sur tout ce qui n’est pas une lettre ou un chiffre (apostrophes, tirets,
 * point médian), on écarte les nombres purs, les mots vides et les fragments de
 * moins de trois lettres.
 */
export function significantKeywordWords(keyword: string): readonly string[] {
  const words = normalizeKeyword(keyword)
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length >= 3 && !/^\d+$/u.test(word) && !KEYWORD_STOPWORDS.has(word));
  return [...new Set(words)];
}

/** Mots significatifs partagés par deux mots-clés (ensemble vide si aucun). */
function sharedSignificantWords(left: string, right: string): readonly string[] {
  const rightWords = new Set(significantKeywordWords(right));
  return significantKeywordWords(left).filter((word) => rightWords.has(word));
}

/** Vérifie les trois champs français et anglais d’un `LocalizedText`. */
function checkLocalizedText(
  issues: DatasetIssue[],
  value: LocalizedText,
  label: string,
  context: { questionId?: number; actId?: ActId },
): void {
  if (!isNonEmpty(value.fr)) {
    issues.push({
      code: 'empty-french',
      message: `Texte français manquant : ${label}.`,
      field: label,
      ...context,
    });
  }
  if (!isNonEmpty(value.en)) {
    issues.push({
      code: 'empty-english',
      message: `Texte anglais manquant : ${label}.`,
      field: label,
      ...context,
    });
  }
}

function checkQuestions(
  issues: DatasetIssue[],
  questions: readonly QuestionItem[],
  questionIdsByAct: Map<ActId, Set<number>>,
): void {
  const seenIds = new Set<number>();
  const seenKeywords = new Map<string, number>();
  const perActCount = new Map<ActId, number>();
  const keywordsByQuestion: { questionId: number; keyword: string }[] = [];

  for (const question of questions) {
    const { id, order, actId, positionInAct } = question;

    const isIdInBounds =
      Number.isInteger(id) &&
      id >= NUMERIC_BOUNDS.questionId.inclusiveMin &&
      id <= NUMERIC_BOUNDS.questionId.inclusiveMax;

    if (!isIdInBounds) {
      issues.push({
        code: 'id-out-of-range',
        message: `Identifiant ${String(id)} hors bornes ${String(NUMERIC_BOUNDS.questionId.inclusiveMin)}..${String(NUMERIC_BOUNDS.questionId.inclusiveMax)}.`,
        questionId: id,
      });
    } else if (seenIds.has(id)) {
      issues.push({
        code: 'duplicate-id',
        message: `Identifiant dupliqué : ${String(id)}.`,
        questionId: id,
      });
    } else {
      seenIds.add(id);
    }

    if (order !== id) {
      issues.push({
        code: 'order-mismatch',
        message: `Rang ${String(order)} incohérent avec l’identifiant ${String(id)} (id === order attendu).`,
        questionId: id,
      });
    }

    const expectedActId = Math.floor((order - 1) / QUESTIONS_PER_ACT) + 1;
    if (actId !== expectedActId) {
      issues.push({
        code: 'act-mismatch',
        message: `Acte ${String(actId)} incohérent avec le rang ${String(order)} (acte ${String(expectedActId)} attendu).`,
        questionId: id,
        actId,
      });
    }

    const expectedPosition = ((order - 1) % QUESTIONS_PER_ACT) + 1;
    if (positionInAct !== expectedPosition) {
      issues.push({
        code: 'position-mismatch',
        message: `Position ${String(positionInAct)} incohérente avec le rang ${String(order)} (position ${String(expectedPosition)} attendue).`,
        questionId: id,
        actId,
      });
    }

    const count = perActCount.get(actId) ?? 0;
    perActCount.set(actId, count + 1);
    const actQuestions = questionIdsByAct.get(actId) ?? new Set<number>();
    actQuestions.add(id);
    questionIdsByAct.set(actId, actQuestions);

    checkLocalizedText(issues, question.keyword, 'keyword', { questionId: id, actId });
    checkLocalizedText(issues, question.prompt, 'prompt', { questionId: id, actId });
    checkLocalizedText(issues, question.mentalImage, 'mentalImage', { questionId: id, actId });

    for (const keyword of [question.keyword.fr, question.keyword.en]) {
      if (!isNonEmpty(keyword)) {
        continue;
      }
      const key = normalizeKeyword(keyword);
      const existingQuestionId = seenKeywords.get(key);
      if (existingQuestionId !== undefined && existingQuestionId !== id) {
        issues.push({
          code: 'duplicate-keyword',
          message: `Mot-clé dupliqué entre les questions ${String(existingQuestionId)} et ${String(id)} : « ${keyword} ».`,
          questionId: id,
          field: 'keyword',
        });
      } else {
        seenKeywords.set(key, id);
      }
      keywordsByQuestion.push({ questionId: id, keyword });
    }
  }

  // Discriminabilité sémantique : deux mots-clés de questions différentes ne
  // doivent partager aucun mot lexical significatif (« qualité », « ami »…),
  // sans quoi un drill mot→question peut mener à la mauvaise question.
  for (let left = 0; left < keywordsByQuestion.length; left += 1) {
    for (let right = left + 1; right < keywordsByQuestion.length; right += 1) {
      const first = keywordsByQuestion[left];
      const second = keywordsByQuestion[right];
      if (first === undefined || second === undefined) continue;
      if (first.questionId === second.questionId) continue;
      const shared = sharedSignificantWords(first.keyword, second.keyword);
      if (shared.length > 0) {
        issues.push({
          code: 'keyword-collision',
          message: `Mots-clés indiscernables : « ${first.keyword} » (Q${String(first.questionId)}) et « ${second.keyword} » (Q${String(second.questionId)}) partagent « ${shared.join(' », « ')} ».`,
          questionId: second.questionId,
          field: 'keyword',
        });
      }
    }
  }

  for (const actId of ACT_IDS) {
    const count = perActCount.get(actId) ?? 0;
    if (count !== QUESTIONS_PER_ACT) {
      issues.push({
        code: 'questions-per-act',
        message: `L’acte ${String(actId)} contient ${String(count)} question(s) au lieu de ${String(QUESTIONS_PER_ACT)}.`,
        actId,
      });
    }
  }
}

function checkFilms(
  issues: DatasetIssue[],
  films: readonly MemoryFilm[],
  questionIdsByAct: Map<ActId, Set<number>>,
): void {
  if (films.length !== ACT_COUNT) {
    issues.push({
      code: 'film-count',
      message: `${String(films.length)} film(s) fourni(s) au lieu de ${String(ACT_COUNT)}.`,
    });
  }

  const filmsByAct = new Map<ActId, MemoryFilm>();
  for (const film of films) {
    if (filmsByAct.has(film.actId)) {
      issues.push({
        code: 'film-count',
        message: `Plusieurs films déclarent l’acte ${String(film.actId)}.`,
        actId: film.actId,
      });
    }
    filmsByAct.set(film.actId, film);
  }

  for (const actId of ACT_IDS) {
    const film = filmsByAct.get(actId);
    if (film === undefined) {
      issues.push({
        code: 'film-missing',
        message: `Aucun film mental pour l’acte ${String(actId)}.`,
        actId,
      });
      continue;
    }

    checkLocalizedText(issues, film.title, 'film.title', { actId });
    checkLocalizedText(issues, film.pitch, 'film.pitch', { actId });

    if (film.scenes.length !== QUESTIONS_PER_ACT) {
      issues.push({
        code: 'film-scene-count',
        message: `Le film de l’acte ${String(actId)} contient ${String(film.scenes.length)} scène(s) au lieu de ${String(QUESTIONS_PER_ACT)}.`,
        actId,
      });
    }

    const sceneIds = new Set<number>();
    film.scenes.forEach((scene, index) => {
      const expectedOrder = index + 1;
      const expectedQuestionId = (actId - 1) * QUESTIONS_PER_ACT + expectedOrder;
      const isLast = index === film.scenes.length - 1;

      if (scene.order !== expectedOrder) {
        issues.push({
          code: 'film-order-mismatch',
          message: `Scène ${String(index)} : ordre ${String(scene.order)} au lieu de ${String(expectedOrder)}.`,
          actId,
          questionId: scene.questionId,
        });
      }
      if (scene.questionId !== expectedQuestionId) {
        issues.push({
          code: 'film-question-mismatch',
          message: `Scène ${String(expectedOrder)} : question ${String(scene.questionId)} au lieu de ${String(expectedQuestionId)}.`,
          actId,
          questionId: scene.questionId,
        });
      }
      if (sceneIds.has(scene.questionId)) {
        issues.push({
          code: 'film-duplicate-question',
          message: `La question ${String(scene.questionId)} apparaît plusieurs fois dans le film de l’acte ${String(actId)}.`,
          actId,
          questionId: scene.questionId,
        });
      }
      sceneIds.add(scene.questionId);

      if (!isLast && scene.transitionToNext === null) {
        issues.push({
          code: 'film-transition-missing',
          message: `Transition manquante après la scène ${String(expectedOrder)} de l’acte ${String(actId)}.`,
          actId,
          questionId: scene.questionId,
        });
      }
      if (isLast && scene.transitionToNext !== null) {
        issues.push({
          code: 'film-transition-unexpected',
          message: `La dernière scène de l’acte ${String(actId)} ne doit pas avoir de transition.`,
          actId,
          questionId: scene.questionId,
        });
      }
      if (scene.transitionToNext !== null) {
        checkLocalizedText(issues, scene.transitionToNext, 'film.transitionToNext', {
          actId,
          questionId: scene.questionId,
        });
      }

      checkLocalizedText(issues, scene.image, 'film.scene.image', {
        actId,
        questionId: scene.questionId,
      });
    });

    const actQuestionIds = questionIdsByAct.get(actId) ?? new Set<number>();
    for (const questionId of actQuestionIds) {
      if (!sceneIds.has(questionId)) {
        issues.push({
          code: 'film-coverage',
          message: `La question ${String(questionId)} n’a pas de scène dans le film de l’acte ${String(actId)}.`,
          actId,
          questionId,
        });
      }
    }
    for (const questionId of sceneIds) {
      if (!actQuestionIds.has(questionId)) {
        issues.push({
          code: 'film-coverage',
          message: `Le film de l’acte ${String(actId)} illustre une question inconnue : ${String(questionId)}.`,
          actId,
          questionId,
        });
      }
    }
  }
}

/**
 * Valide un dataset complet. Résultat explicite ; aucune exception ne franchit
 * cette frontière.
 */
export function validateDataset(input: DatasetValidationInput): DatasetValidationResult {
  const issues: DatasetIssue[] = [];
  const questionIdsByAct = new Map<ActId, Set<number>>();

  if (input.questions.length !== QUESTION_COUNT) {
    issues.push({
      code: 'question-count',
      message: `${String(input.questions.length)} question(s) fournie(s) au lieu de ${String(QUESTION_COUNT)}.`,
    });
  }

  checkQuestions(issues, input.questions, questionIdsByAct);
  checkFilms(issues, input.films, questionIdsByAct);

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, metadata: buildDatasetMetadata(input.questions) };
}
