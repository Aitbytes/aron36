import { NUMERIC_BOUNDS } from '@/domain/shared/types';
import type { EpochMs, QuestionId } from '@/domain/shared/types';

import type { HookLibrary, PersonalHook, PersonalHookKind } from './types';

/**
 * Bibliothèque d’accroches personnelles (L10, L11).
 *
 * Une accroche est écrite par l’apprenant pour une question ; elle est
 * réinjectée telle quelle comme indice de drill. Le contrat gelé
 * (`memory/types.ts`, `progress/types.ts`) impose **au plus une accroche par
 * question** : le `kind` décrit la nature de cette unique accroche et peut être
 * changé par un remplacement. Toute opération renvoie un résultat explicite ;
 * aucune exception ne franchit cette frontière.
 */

/** Longueur minimale d’une accroche (après normalisation des espaces). */
export const HOOK_TEXT_MIN_LENGTH = 1;

/** Longueur maximale d’une accroche, en caractères (contrat gelé : 1..280). */
export const HOOK_TEXT_MAX_LENGTH = 280;

/** Les trois natures d’accroche du contrat gelé. */
export const PERSONAL_HOOK_KINDS = [
  'keyword',
  'story',
  'autobiographical',
] as const satisfies readonly PersonalHookKind[];

/** Codes d’erreur stables des opérations sur les accroches. */
export type HookErrorCode =
  | 'invalid-question-id'
  | 'empty-text'
  | 'text-too-long'
  | 'hook-exists'
  | 'hook-not-found'
  | 'invalid-time';

/** Erreur explicite d’une opération sur les accroches. */
export interface HookError {
  readonly code: HookErrorCode;
  readonly message: string;
  readonly questionId?: QuestionId;
  readonly kind?: PersonalHookKind;
  readonly maxLength?: number;
}

/** Entrée d’ajout ou de remplacement d’une accroche. */
export interface HookInput {
  readonly questionId: QuestionId;
  readonly kind: PersonalHookKind;
  readonly text: string;
}

/** Résultat d’une opération qui crée ou modifie une accroche. */
export type HookMutationResult =
  | { readonly ok: true; readonly library: HookLibrary; readonly hook: PersonalHook }
  | { readonly ok: false; readonly error: HookError };

/** Résultat d’une suppression. */
export type HookRemovalResult =
  | { readonly ok: true; readonly library: HookLibrary }
  | { readonly ok: false; readonly error: HookError };

/** Réduit les espaces et rogne le texte : la longueur se mesure sur ce résultat. */
export function normalizeHookText(text: string): string {
  return text.trim().replace(/\s+/gu, ' ');
}

/** Vrai si l’identifiant est un entier dans les bornes `questionId` du contrat. */
export function isValidQuestionId(questionId: number): boolean {
  return (
    Number.isInteger(questionId) &&
    questionId >= NUMERIC_BOUNDS.questionId.inclusiveMin &&
    questionId <= NUMERIC_BOUNDS.questionId.inclusiveMax
  );
}

/** Vrai si l’horodatage est un entier d’époque plausible (≥ 0). */
export function isValidEpochMs(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** Bibliothèque vide : aucune accroche, modifiée à `now`. */
export function createEmptyHookLibrary(now: EpochMs): HookLibrary {
  return { hooks: [], updatedAt: now };
}

/** Accroche d’une question, `undefined` s’il n’y en a pas. */
export function findHook(library: HookLibrary, questionId: QuestionId): PersonalHook | undefined {
  return library.hooks.find((hook) => hook.questionId === questionId);
}

/** Accroche d’une question **et** d’une nature données, `undefined` sinon. */
export function findHookByKind(
  library: HookLibrary,
  questionId: QuestionId,
  kind: PersonalHookKind,
): PersonalHook | undefined {
  return library.hooks.find((hook) => hook.questionId === questionId && hook.kind === kind);
}

function sortHooks(hooks: readonly PersonalHook[]): readonly PersonalHook[] {
  return [...hooks].sort((left, right) => left.questionId - right.questionId);
}

type HookInputValidation =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: HookError };

function validateInput(input: HookInput, now: EpochMs): HookInputValidation {
  if (!isValidEpochMs(now)) {
    return { ok: false, error: { code: 'invalid-time', message: 'Horodatage invalide.' } };
  }
  if (!isValidQuestionId(input.questionId)) {
    return {
      ok: false,
      error: {
        code: 'invalid-question-id',
        message: `Identifiant de question hors bornes : ${String(input.questionId)}.`,
        questionId: input.questionId,
        kind: input.kind,
      },
    };
  }
  const text = normalizeHookText(input.text);
  if (text.length < HOOK_TEXT_MIN_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'empty-text',
        message: 'L’accroche est vide.',
        questionId: input.questionId,
        kind: input.kind,
      },
    };
  }
  if (text.length > HOOK_TEXT_MAX_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'text-too-long',
        message: `L’accroche dépasse ${String(HOOK_TEXT_MAX_LENGTH)} caractères (${String(text.length)}).`,
        questionId: input.questionId,
        kind: input.kind,
        maxLength: HOOK_TEXT_MAX_LENGTH,
      },
    };
  }
  return { ok: true, text };
}

/**
 * Ajoute une accroche. Échoue si la question possède déjà une accroche, quelle
 * que soit sa nature : utiliser `replaceHook` pour la modifier.
 */
export function addHook(library: HookLibrary, input: HookInput, now: EpochMs): HookMutationResult {
  const validation = validateInput(input, now);
  if (!validation.ok) {
    return validation;
  }
  if (findHook(library, input.questionId) !== undefined) {
    return {
      ok: false,
      error: {
        code: 'hook-exists',
        message: `La question ${String(input.questionId)} a déjà une accroche.`,
        questionId: input.questionId,
        kind: input.kind,
      },
    };
  }
  const hook: PersonalHook = {
    questionId: input.questionId,
    kind: input.kind,
    text: validation.text,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ok: true,
    library: { hooks: sortHooks([...library.hooks, hook]), updatedAt: now },
    hook,
  };
}

/**
 * Remplace l’accroche existante d’une question. La date de création d’origine
 * est conservée, la nature et le texte sont mis à jour.
 */
export function replaceHook(
  library: HookLibrary,
  input: HookInput,
  now: EpochMs,
): HookMutationResult {
  const validation = validateInput(input, now);
  if (!validation.ok) {
    return validation;
  }
  const existing = findHook(library, input.questionId);
  if (existing === undefined) {
    return {
      ok: false,
      error: {
        code: 'hook-not-found',
        message: `Aucune accroche à remplacer pour la question ${String(input.questionId)}.`,
        questionId: input.questionId,
        kind: input.kind,
      },
    };
  }
  const hook: PersonalHook = {
    questionId: input.questionId,
    kind: input.kind,
    text: validation.text,
    createdAt: existing.createdAt,
    updatedAt: now,
  };
  return {
    ok: true,
    library: {
      hooks: library.hooks.map((candidate) =>
        candidate.questionId === hook.questionId ? hook : candidate,
      ),
      updatedAt: now,
    },
    hook,
  };
}

/** Ajoute ou remplace selon qu’une accroche existe déjà pour la question. */
export function upsertHook(
  library: HookLibrary,
  input: HookInput,
  now: EpochMs,
): HookMutationResult {
  return findHook(library, input.questionId) === undefined
    ? addHook(library, input, now)
    : replaceHook(library, input, now);
}

/** Supprime l’accroche d’une question. Échoue si elle n’existe pas. */
export function removeHook(
  library: HookLibrary,
  questionId: QuestionId,
  now: EpochMs,
): HookRemovalResult {
  if (!isValidEpochMs(now)) {
    return { ok: false, error: { code: 'invalid-time', message: 'Horodatage invalide.' } };
  }
  if (!isValidQuestionId(questionId)) {
    return {
      ok: false,
      error: {
        code: 'invalid-question-id',
        message: `Identifiant de question hors bornes : ${String(questionId)}.`,
        questionId,
      },
    };
  }
  if (findHook(library, questionId) === undefined) {
    return {
      ok: false,
      error: {
        code: 'hook-not-found',
        message: `Aucune accroche à supprimer pour la question ${String(questionId)}.`,
        questionId,
      },
    };
  }
  return {
    ok: true,
    library: {
      hooks: library.hooks.filter((hook) => hook.questionId !== questionId),
      updatedAt: now,
    },
  };
}

/** Nombre d’accroches, éventuellement filtré par nature. */
export function countHooks(library: HookLibrary, kind?: PersonalHookKind): number {
  if (kind === undefined) {
    return library.hooks.length;
  }
  return library.hooks.filter((hook) => hook.kind === kind).length;
}
