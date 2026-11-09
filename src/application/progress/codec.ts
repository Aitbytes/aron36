import type {
  BadgeState,
  CollectionEntry,
  PlayerProfile,
  PlayerSettings,
  PlayerState,
  QuestBoard,
  QuestState,
  StreakState,
} from '@/domain/gamification/types';
import { DAILY_QUEST_COUNT, STREAK_RULES } from '@/domain/gamification/types';
import type { HookLibrary, PersonalHook } from '@/domain/memory/types';
import type {
  ExportEnvelope,
  PersistedProgress,
  ProgressCodec,
  ProgressDecodeResult,
  ProgressError,
  ProgressImportResult,
  Migration,
} from '@/domain/progress/types';
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  MAX_REVIEW_LOG_ENTRIES,
  MAX_SESSION_LOG_ENTRIES,
  MAX_SUPPORTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  SCHEMA_VERSION,
} from '@/domain/progress/types';
import type { CardPhase, CardState, ReviewLog } from '@/domain/srs/types';
import type { SessionLog, SessionMode } from '@/domain/session/types';
import type {
  BoundedFieldName,
  ConfidenceRating,
  DayKey,
  EpochMs,
  IsoDateTime,
  LocaleCode,
  QuestionId,
} from '@/domain/shared/types';
import {
  DRILL_DIRECTIONS,
  EXERCISE_KINDS,
  NUMERIC_BOUNDS,
  QUESTION_COUNT,
  REVIEW_GRADES,
  SESSION_WINDOWS,
} from '@/domain/shared/types';
import { MIGRATIONS } from './migrations';

/**
 * Codec de persistance (ADR 0004, ADR 0009).
 *
 * Frontière unique entre « octets non fiables » et état du domaine :
 * - `encode` sérialise en JSON **stable** (clés triées récursivement), pour que
 *   les tests et les comparaisons de dérive soient fiables ;
 * - `decode` n'accepte **que** le format interne : parse → routage de version
 *   (`future-version` / `unsupported-version` / chaîne de migrations) →
 *   validation de forme → validation des invariants → normalisation
 *   (journaux triés et tronqués). Toute anomalie est un résultat typé,
 *   jamais une exception ;
 * - `toExport` / `fromExport` manipulent l'enveloppe d'export, format public
 *   distinct du format interne (aucun décodeur ne tente l'autre format).
 *
 * Validation numérique (ADR 0009) : tout champ borné venant de l'extérieur est
 * confronté à `NUMERIC_BOUNDS` ; hors bornes ⇒ rejet (`invalid-shape`),
 * jamais de « clamp » silencieux qui masquerait une corruption.
 */

/** Options du codec : registre et version cible injectables (tests, future v2). */
export interface ProgressCodecOptions {
  readonly migrations?: readonly Migration[] | undefined;
  readonly schemaVersion?: number | undefined;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Sérialisation stable
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * JSON canonique : les clés de chaque objet sont triées (ordre lexicographique),
 * les tableaux gardent leur ordre. `encode` ne valide pas : il reçoit un état
 * déjà typé par le domaine ; la validation est le travail de `decode`.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(stabilize(value));
}

function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stabilize(item));
  }
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(compareStrings)) {
      sorted[key] = stabilize(source[key]);
    }
    return sorted;
  }
  return value;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Primitives de validation
 * ───────────────────────────────────────────────────────────────────────────── */

type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ProgressError };

function fail(
  field: string,
  message: string,
): { readonly ok: false; readonly error: ProgressError } {
  return { ok: false, error: { code: 'invalid-shape', message, details: { field } } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredField(root: Record<string, unknown>, field: string): Outcome<unknown> {
  if (!(field in root)) {
    return fail(field, `champ requis absent : ${field}`);
  }
  return { ok: true, value: root[field] };
}

function validateEpoch(value: unknown, field: string): Outcome<EpochMs> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return fail(field, `instant epoch invalide (entier ≥ 0 attendu) : ${String(value)}`);
  }
  return { ok: true, value };
}

function validateInteger(
  value: unknown,
  field: string,
  min: number,
  max?: number | null,
): Outcome<number> {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fail(field, `entier attendu : ${String(value)}`);
  }
  return validateRange(value, field, min, max);
}

/**
 * Nombre (fractionnaire autorisé) confronté aux bornes. Rejet, pas de clamp :
 * une valeur hors bornes est une corruption, pas une donnée à corriger.
 */
function validateNumber(
  value: unknown,
  field: string,
  min: number,
  max?: number | null,
): Outcome<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(field, `nombre attendu : ${String(value)}`);
  }
  return validateRange(value, field, min, max);
}

function validateRange(
  value: number,
  field: string,
  min: number,
  max?: number | null,
): Outcome<number> {
  if (value < min || (max !== null && max !== undefined && value > max)) {
    const upper = max === null || max === undefined ? '+∞' : String(max);
    return fail(field, `valeur hors bornes [${min}, ${upper}] : ${String(value)}`);
  }
  return { ok: true, value };
}

/** Champ borné du domaine via `NUMERIC_BOUNDS` (ADR 0009). */
function validateBounded(
  value: unknown,
  field: string,
  bound: BoundedFieldName,
  integer: boolean,
): Outcome<number> {
  const bounds = NUMERIC_BOUNDS[bound];
  return integer
    ? validateInteger(value, field, bounds.inclusiveMin, bounds.inclusiveMax)
    : validateNumber(value, field, bounds.inclusiveMin, bounds.inclusiveMax);
}

function validateString(value: unknown, field: string): Outcome<string> {
  if (typeof value !== 'string') {
    return fail(field, `chaîne attendue : ${String(value)}`);
  }
  return { ok: true, value };
}

function validateBoolean(value: unknown, field: string): Outcome<boolean> {
  if (typeof value !== 'boolean') {
    return fail(field, `booléen attendu : ${String(value)}`);
  }
  return { ok: true, value };
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): Outcome<T> {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return fail(field, `valeur hors énumération : ${String(value)}`);
  }
  return { ok: true, value: value as T };
}

function validateNumericEnum<T extends number>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): Outcome<T> {
  if (typeof value !== 'number' || !allowed.includes(value as T)) {
    return fail(field, `valeur hors énumération numérique : ${String(value)}`);
  }
  return { ok: true, value: value as T };
}

function validateDayKey(value: unknown, field: string): Outcome<DayKey> {
  const checked = validateString(value, field);
  if (!checked.ok) {
    return checked;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checked.value)) {
    return fail(field, `jour civil invalide (YYYY-MM-DD attendu) : ${checked.value}`);
  }
  return { ok: true, value: checked.value };
}

function validateEpochOrNull(value: unknown, field: string): Outcome<EpochMs | null> {
  if (value === null) {
    return { ok: true, value: null };
  }
  return validateEpoch(value, field);
}

function validateArray(value: unknown, field: string): Outcome<readonly unknown[]> {
  if (!Array.isArray(value)) {
    return fail(field, `tableau attendu : ${String(value)}`);
  }
  return { ok: true, value };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Énumérations locales, tenues en phase avec les unions gelées du domaine
 * ───────────────────────────────────────────────────────────────────────────── */

const CARD_PHASES: readonly CardPhase[] = ['new', 'learning', 'review', 'relearning'];
const PERSONAL_HOOK_KINDS: readonly PersonalHook['kind'][] = [
  'keyword',
  'story',
  'autobiographical',
];
const CARD_RARITIES: readonly CollectionEntry['rarity'][] = ['common', 'rare', 'epic'];
const MASTERY_TIERS: readonly CollectionEntry['masteryTier'][] = [1, 2, 3, 4, 5];
const SESSION_MODES: readonly SessionMode[] = [
  'discovery',
  'learning',
  'review',
  'recitation',
  'speed',
  'grand-oral',
];
const LOCALE_VALUES: readonly LocaleCode[] = ['fr', 'en'];
const REDUCED_MOTION_MODES: readonly PlayerSettings['reducedMotion'][] = [
  'system',
  'reduce',
  'no-preference',
];
const DAILY_GOAL_MINUTES: readonly PlayerSettings['dailyGoalMinutes'][] = [10, 15, 20, 25];

const HOOK_TEXT_MIN_LENGTH = 1;
const HOOK_TEXT_MAX_LENGTH = 280;

/** Clé décimale canonique (pas de zéro initial : `"07"` est rejeté). */
const DECIMAL_KEY_PATTERN = /^[1-9]\d*$/;

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/* ─────────────────────────────────────────────────────────────────────────────
 * Validation des entités persistées
 * ───────────────────────────────────────────────────────────────────────────── */

function validateCard(value: unknown, field: string): Outcome<CardState> {
  if (!isRecord(value)) {
    return fail(field, 'carte non objet');
  }
  const questionId = validateBounded(value.questionId, `${field}.questionId`, 'questionId', true);
  if (!questionId.ok) return questionId;
  const phase = validateEnum(value.phase, CARD_PHASES, `${field}.phase`);
  if (!phase.ok) return phase;
  const dueAt = validateEpoch(value.dueAt, `${field}.dueAt`);
  if (!dueAt.ok) return dueAt;
  const intervalDays = validateBounded(
    value.intervalDays,
    `${field}.intervalDays`,
    'intervalDays',
    false,
  );
  if (!intervalDays.ok) return intervalDays;
  const stabilityDays = validateBounded(
    value.stabilityDays,
    `${field}.stabilityDays`,
    'stabilityDays',
    false,
  );
  if (!stabilityDays.ok) return stabilityDays;
  const learningStep = validateBounded(
    value.learningStep,
    `${field}.learningStep`,
    'learningStep',
    true,
  );
  if (!learningStep.ok) return learningStep;
  const difficulty = validateBounded(value.difficulty, `${field}.difficulty`, 'difficulty', false);
  if (!difficulty.ok) return difficulty;
  const reps = validateInteger(value.reps, `${field}.reps`, 0);
  if (!reps.ok) return reps;
  const lapses = validateInteger(value.lapses, `${field}.lapses`, 0);
  if (!lapses.ok) return lapses;
  const consecutive = validateInteger(
    value.consecutiveSuccesses,
    `${field}.consecutiveSuccesses`,
    0,
  );
  if (!consecutive.ok) return consecutive;
  const lastReviewedAt = validateEpochOrNull(value.lastReviewedAt, `${field}.lastReviewedAt`);
  if (!lastReviewedAt.ok) return lastReviewedAt;
  const lastGrade =
    value.lastGrade === null
      ? ({ ok: true, value: null } as const)
      : validateEnum(value.lastGrade, REVIEW_GRADES, `${field}.lastGrade`);
  if (!lastGrade.ok) return lastGrade;

  // Invariants gelés du contrat `CardState`.
  if (phase.value === 'new' && (reps.value !== 0 || lastReviewedAt.value !== null)) {
    return fail(field, 'une carte « new » n’a ni révision ni dernière date');
  }
  if ((lastGrade.value === null) !== (lastReviewedAt.value === null)) {
    return fail(field, 'lastGrade et lastReviewedAt doivent coexister ou être absents ensemble');
  }
  const card: CardState = {
    questionId: questionId.value,
    phase: phase.value,
    dueAt: dueAt.value,
    intervalDays: intervalDays.value,
    stabilityDays: stabilityDays.value,
    learningStep: learningStep.value,
    difficulty: difficulty.value,
    reps: reps.value,
    lapses: lapses.value,
    consecutiveSuccesses: consecutive.value,
    lastReviewedAt: lastReviewedAt.value,
    lastGrade: lastGrade.value,
  };
  return { ok: true, value: card };
}

function validateCards(value: unknown): Outcome<PersistedProgress['cards']> {
  if (!isRecord(value)) {
    return fail('cards', '« cards » doit être un objet');
  }
  const cards: Record<string, CardState> = {};
  for (const [key, rawCard] of Object.entries(value)) {
    // Chaque clé doit être un identifiant 1..36 en décimal canonique et
    // coïncider avec `card.questionId` (l'ensemble peut être partiel : seules
    // les questions rencontrées figurent, par exemple après un import v0).
    if (!DECIMAL_KEY_PATTERN.test(key)) {
      return fail(`cards.${key}`, `clé de carte non décimale canonique : « ${key} »`);
    }
    const questionId = Number(key);
    const bounds = NUMERIC_BOUNDS.questionId;
    if (questionId < bounds.inclusiveMin || questionId > bounds.inclusiveMax) {
      return fail(`cards.${key}`, `identifiant de question hors bornes : ${key}`);
    }
    const card = validateCard(rawCard, `cards.${key}`);
    if (!card.ok) return card;
    if (card.value.questionId !== questionId) {
      return fail(
        `cards.${key}.questionId`,
        `clé « ${key} » et questionId ${card.value.questionId} divergent`,
      );
    }
    cards[key] = card.value;
  }
  return { ok: true, value: cards };
}

function validateHooks(value: unknown): Outcome<HookLibrary> {
  if (!isRecord(value)) {
    return fail('hooks', '« hooks » doit être un objet');
  }
  const list = validateArray(value.hooks, 'hooks.hooks');
  if (!list.ok) return list;
  const updatedAt = validateEpoch(value.updatedAt, 'hooks.updatedAt');
  if (!updatedAt.ok) return updatedAt;
  const seenQuestionIds = new Set<number>();
  const hooks: PersonalHook[] = [];
  for (const [index, rawHook] of list.value.entries()) {
    const field = `hooks.hooks[${index}]`;
    if (!isRecord(rawHook)) {
      return fail(field, 'accroche non objet');
    }
    const questionId = validateBounded(
      rawHook.questionId,
      `${field}.questionId`,
      'questionId',
      true,
    );
    if (!questionId.ok) return questionId;
    const kind = validateEnum(rawHook.kind, PERSONAL_HOOK_KINDS, `${field}.kind`);
    if (!kind.ok) return kind;
    const text = validateString(rawHook.text, `${field}.text`);
    if (!text.ok) return text;
    if (text.value.length < HOOK_TEXT_MIN_LENGTH || text.value.length > HOOK_TEXT_MAX_LENGTH) {
      return fail(`${field}.text`, `longueur d’accroche hors bornes : ${text.value.length}`);
    }
    const createdAt = validateEpoch(rawHook.createdAt, `${field}.createdAt`);
    if (!createdAt.ok) return createdAt;
    const hookUpdatedAt = validateEpoch(rawHook.updatedAt, `${field}.updatedAt`);
    if (!hookUpdatedAt.ok) return hookUpdatedAt;
    // Invariant gelé : au plus une accroche par question.
    if (seenQuestionIds.has(questionId.value)) {
      return fail(`${field}.questionId`, `accroche dupliquée pour la question ${questionId.value}`);
    }
    seenQuestionIds.add(questionId.value);
    hooks.push({
      questionId: questionId.value,
      kind: kind.value,
      text: text.value,
      createdAt: createdAt.value,
      updatedAt: hookUpdatedAt.value,
    });
  }
  return { ok: true, value: { hooks, updatedAt: updatedAt.value } };
}

function validateReviewLog(value: unknown, field: string): Outcome<ReviewLog> {
  if (!isRecord(value)) {
    return fail(field, 'ligne de journal non objet');
  }
  const id = validateString(value.id, `${field}.id`);
  if (!id.ok) return id;
  const sessionId = validateString(value.sessionId, `${field}.sessionId`);
  if (!sessionId.ok) return sessionId;
  const questionId = validateBounded(value.questionId, `${field}.questionId`, 'questionId', true);
  if (!questionId.ok) return questionId;
  const direction = validateEnum(value.direction, DRILL_DIRECTIONS, `${field}.direction`);
  if (!direction.ok) return direction;
  const exerciseKind = validateEnum(value.exerciseKind, EXERCISE_KINDS, `${field}.exerciseKind`);
  if (!exerciseKind.ok) return exerciseKind;
  const grade = validateEnum(value.grade, REVIEW_GRADES, `${field}.grade`);
  if (!grade.ok) return grade;
  const reviewedAt = validateEpoch(value.reviewedAt, `${field}.reviewedAt`);
  if (!reviewedAt.ok) return reviewedAt;
  const previousDueAt = validateEpochOrNull(value.previousDueAt, `${field}.previousDueAt`);
  if (!previousDueAt.ok) return previousDueAt;
  const nextDueAt = validateEpoch(value.nextDueAt, `${field}.nextDueAt`);
  if (!nextDueAt.ok) return nextDueAt;
  const intervalDays = validateBounded(
    value.intervalDays,
    `${field}.intervalDays`,
    'intervalDays',
    false,
  );
  if (!intervalDays.ok) return intervalDays;
  const elapsedDays = validateBounded(
    value.elapsedDays,
    `${field}.elapsedDays`,
    'elapsedDays',
    false,
  );
  if (!elapsedDays.ok) return elapsedDays;
  const responseTimeMs = validateBounded(
    value.responseTimeMs,
    `${field}.responseTimeMs`,
    'durationMs',
    false,
  );
  if (!responseTimeMs.ok) return responseTimeMs;
  const hintsUsed = validateInteger(value.hintsUsed, `${field}.hintsUsed`, 0);
  if (!hintsUsed.ok) return hintsUsed;
  const confidence =
    value.confidence === null
      ? ({ ok: true, value: null } as const)
      : validateBounded(value.confidence, `${field}.confidence`, 'confidence', true);
  if (!confidence.ok) return confidence;
  const log: ReviewLog = {
    id: id.value,
    sessionId: sessionId.value,
    questionId: questionId.value,
    direction: direction.value,
    exerciseKind: exerciseKind.value,
    grade: grade.value,
    reviewedAt: reviewedAt.value,
    previousDueAt: previousDueAt.value,
    nextDueAt: nextDueAt.value,
    intervalDays: intervalDays.value,
    elapsedDays: elapsedDays.value,
    responseTimeMs: responseTimeMs.value,
    hintsUsed: hintsUsed.value,
    confidence: confidence.value as ConfidenceRating | null,
  };
  return { ok: true, value: log };
}

function validateSessionLog(value: unknown, field: string): Outcome<SessionLog> {
  if (!isRecord(value)) {
    return fail(field, 'ligne de session non objet');
  }
  const sessionId = validateString(value.sessionId, `${field}.sessionId`);
  if (!sessionId.ok) return sessionId;
  const mode = validateEnum(value.mode, SESSION_MODES, `${field}.mode`);
  if (!mode.ok) return mode;
  const planSeed = validateString(value.planSeed, `${field}.planSeed`);
  if (!planSeed.ok) return planSeed;
  const startedAt = validateEpoch(value.startedAt, `${field}.startedAt`);
  if (!startedAt.ok) return startedAt;
  const endedAt = validateEpoch(value.endedAt, `${field}.endedAt`);
  if (!endedAt.ok) return endedAt;
  const durationMs = validateBounded(value.durationMs, `${field}.durationMs`, 'durationMs', false);
  if (!durationMs.ok) return durationMs;
  const sessionWindow = validateEnum(value.window, SESSION_WINDOWS, `${field}.window`);
  if (!sessionWindow.ok) return sessionWindow;
  const counterFields = [
    'itemCount',
    'productionCount',
    'discriminationCount',
    'spokenCount',
    'correctCount',
    'xpAwarded',
  ] as const;
  const counters: Record<(typeof counterFields)[number], number> = {
    itemCount: 0,
    productionCount: 0,
    discriminationCount: 0,
    spokenCount: 0,
    correctCount: 0,
    xpAwarded: 0,
  };
  for (const name of counterFields) {
    const checked = validateInteger(value[name], `${field}.${name}`, 0);
    if (!checked.ok) return checked;
    counters[name] = checked.value;
  }
  const accuracy = validateBounded(value.accuracy, `${field}.accuracy`, 'ratio', false);
  if (!accuracy.ok) return accuracy;
  const log: SessionLog = {
    sessionId: sessionId.value,
    mode: mode.value,
    planSeed: planSeed.value,
    startedAt: startedAt.value,
    endedAt: endedAt.value,
    durationMs: durationMs.value,
    window: sessionWindow.value,
    itemCount: counters.itemCount,
    productionCount: counters.productionCount,
    discriminationCount: counters.discriminationCount,
    spokenCount: counters.spokenCount,
    correctCount: counters.correctCount,
    accuracy: accuracy.value,
    xpAwarded: counters.xpAwarded,
  };
  return { ok: true, value: log };
}

/**
 * Choix documenté : un journal **non trié** est remis en ordre canonique
 * (du plus ancien au plus récent, tri stable) plutôt que rejeté — l'ordre est
 * une propriété de présentation, perdre des lignes serait pire. Un journal
 * **trop long** est tronqué aux `MAX_*_LOG_ENTRIES` **les plus récentes**
 * (rétention gelée par la Phase 1). Chaque ligne reste strictement validée :
 * une ligne invalide rejette tout l'état.
 */
function normalizeLogs<T>(
  value: unknown,
  field: string,
  maxEntries: number,
  validateLine: (line: unknown, lineField: string) => Outcome<T>,
  timestampOf: (line: T) => EpochMs,
): Outcome<readonly T[]> {
  const list = validateArray(value, field);
  if (!list.ok) return list;
  const lines: T[] = [];
  for (const [index, rawLine] of list.value.entries()) {
    const line = validateLine(rawLine, `${field}[${index}]`);
    if (!line.ok) return line;
    lines.push(line.value);
  }
  lines.sort((a, b) => timestampOf(a) - timestampOf(b));
  const truncated = lines.length > maxEntries ? lines.slice(lines.length - maxEntries) : lines;
  return { ok: true, value: truncated };
}

function validateProfile(value: unknown): Outcome<PlayerProfile> {
  if (!isRecord(value)) {
    return fail('player.profile', 'profil non objet');
  }
  const id = validateString(value.id, 'player.profile.id');
  if (!id.ok) return id;
  const displayName = validateString(value.displayName, 'player.profile.displayName');
  if (!displayName.ok) return displayName;
  const createdAt = validateEpoch(value.createdAt, 'player.profile.createdAt');
  if (!createdAt.ok) return createdAt;
  return {
    ok: true,
    value: { id: id.value, displayName: displayName.value, createdAt: createdAt.value },
  };
}

function validateStreak(value: unknown): Outcome<StreakState> {
  if (!isRecord(value)) {
    return fail('player.streak', 'série non objet');
  }
  const current = validateInteger(value.current, 'player.streak.current', 0);
  if (!current.ok) return current;
  const longest = validateInteger(value.longest, 'player.streak.longest', 0);
  if (!longest.ok) return longest;
  if (current.value > longest.value) {
    return fail('player.streak.current', 'la série courante ne peut pas dépasser le record');
  }
  const lastActiveDay =
    value.lastActiveDay === null
      ? ({ ok: true, value: null } as const)
      : validateDayKey(value.lastActiveDay, 'player.streak.lastActiveDay');
  if (!lastActiveDay.ok) return lastActiveDay;
  const freezes = validateInteger(
    value.freezes,
    'player.streak.freezes',
    0,
    STREAK_RULES.maxFreezes,
  );
  if (!freezes.ok) return freezes;
  const frozenDays = validateArray(value.frozenDays, 'player.streak.frozenDays');
  if (!frozenDays.ok) return frozenDays;
  const days: DayKey[] = [];
  for (const [index, rawDay] of frozenDays.value.entries()) {
    const day = validateDayKey(rawDay, `player.streak.frozenDays[${index}]`);
    if (!day.ok) return day;
    days.push(day.value);
  }
  return {
    ok: true,
    value: {
      current: current.value,
      longest: longest.value,
      lastActiveDay: lastActiveDay.value,
      freezes: freezes.value,
      frozenDays: days,
    },
  };
}

function validateBadges(value: unknown): Outcome<readonly BadgeState[]> {
  const list = validateArray(value, 'player.badges');
  if (!list.ok) return list;
  const badges: BadgeState[] = [];
  for (const [index, rawBadge] of list.value.entries()) {
    const field = `player.badges[${index}]`;
    if (!isRecord(rawBadge)) {
      return fail(field, 'badge non objet');
    }
    const badgeId = validateString(rawBadge.badgeId, `${field}.badgeId`);
    if (!badgeId.ok) return badgeId;
    const unlockedAt = validateEpochOrNull(rawBadge.unlockedAt, `${field}.unlockedAt`);
    if (!unlockedAt.ok) return unlockedAt;
    const target = validateInteger(rawBadge.target, `${field}.target`, 0);
    if (!target.ok) return target;
    const progress = validateInteger(rawBadge.progress, `${field}.progress`, 0, target.value);
    if (!progress.ok) return progress;
    badges.push({
      badgeId: badgeId.value,
      unlockedAt: unlockedAt.value,
      progress: progress.value,
      target: target.value,
    });
  }
  return { ok: true, value: badges };
}

function validateQuests(value: unknown, field: string): Outcome<readonly QuestState[]> {
  const list = validateArray(value, field);
  if (!list.ok) return list;
  const quests: QuestState[] = [];
  for (const [index, rawQuest] of list.value.entries()) {
    const questField = `${field}[${index}]`;
    if (!isRecord(rawQuest)) {
      return fail(questField, 'quête non objet');
    }
    const questId = validateString(rawQuest.questId, `${questField}.questId`);
    if (!questId.ok) return questId;
    const dayKey = validateDayKey(rawQuest.dayKey, `${questField}.dayKey`);
    if (!dayKey.ok) return dayKey;
    const progress = validateInteger(rawQuest.progress, `${questField}.progress`, 0);
    if (!progress.ok) return progress;
    const target = validateInteger(rawQuest.target, `${questField}.target`, 0);
    if (!target.ok) return target;
    const completedAt = validateEpochOrNull(rawQuest.completedAt, `${questField}.completedAt`);
    if (!completedAt.ok) return completedAt;
    const attempts = validateInteger(rawQuest.attempts, `${questField}.attempts`, 0);
    if (!attempts.ok) return attempts;
    const correct = validateInteger(rawQuest.correct, `${questField}.correct`, 0);
    if (!correct.ok) return correct;
    const seen = validateArray(rawQuest.seenQuestionIds, `${questField}.seenQuestionIds`);
    if (!seen.ok) return seen;
    const seenQuestionIds: QuestionId[] = [];
    for (const [seenIndex, rawSeen] of seen.value.entries()) {
      const seenField = `${questField}.seenQuestionIds[${seenIndex}]`;
      const questionId = validateBounded(rawSeen, seenField, 'questionId', true);
      if (!questionId.ok) return questionId;
      seenQuestionIds.push(questionId.value);
    }
    quests.push({
      questId: questId.value,
      dayKey: dayKey.value,
      progress: progress.value,
      target: target.value,
      completedAt: completedAt.value,
      attempts: attempts.value,
      correct: correct.value,
      seenQuestionIds,
    });
  }
  return { ok: true, value: quests };
}

function validateQuestBoard(value: unknown): Outcome<QuestBoard | null> {
  if (value === null) {
    return { ok: true, value: null };
  }
  if (!isRecord(value)) {
    return fail('player.questBoard', 'tableau de quêtes non objet');
  }
  const dayKey = validateDayKey(value.dayKey, 'player.questBoard.dayKey');
  if (!dayKey.ok) return dayKey;
  const seed = validateString(value.seed, 'player.questBoard.seed');
  if (!seed.ok) return seed;
  const quests = validateQuests(value.quests, 'player.questBoard.quests');
  if (!quests.ok) return quests;
  // Invariant gelé : exactement trois quêtes quotidiennes.
  if (quests.value.length !== DAILY_QUEST_COUNT) {
    return fail(
      'player.questBoard.quests',
      `le tableau quotidien porte ${quests.value.length} quêtes au lieu de ${DAILY_QUEST_COUNT}`,
    );
  }
  return { ok: true, value: { dayKey: dayKey.value, seed: seed.value, quests: quests.value } };
}

function validateCollection(value: unknown): Outcome<PersistedProgress['player']['collection']> {
  if (!isRecord(value)) {
    return fail('player.collection', 'collection non objet');
  }
  const list = validateArray(value.entries, 'player.collection.entries');
  if (!list.ok) return list;
  // Invariant gelé : au plus 36 entrées, une par question, jamais retirée.
  if (list.value.length > QUESTION_COUNT) {
    return fail('player.collection.entries', `collection surdimensionnée : ${list.value.length}`);
  }
  const seenQuestionIds = new Set<number>();
  const entries: CollectionEntry[] = [];
  for (const [index, rawEntry] of list.value.entries()) {
    const field = `player.collection.entries[${index}]`;
    if (!isRecord(rawEntry)) {
      return fail(field, 'entrée de collection non objet');
    }
    const questionId = validateBounded(
      rawEntry.questionId,
      `${field}.questionId`,
      'questionId',
      true,
    );
    if (!questionId.ok) return questionId;
    if (seenQuestionIds.has(questionId.value)) {
      return fail(`${field}.questionId`, `entrée dupliquée pour la question ${questionId.value}`);
    }
    seenQuestionIds.add(questionId.value);
    const rarity = validateEnum(rawEntry.rarity, CARD_RARITIES, `${field}.rarity`);
    if (!rarity.ok) return rarity;
    const obtainedAt = validateEpoch(rawEntry.obtainedAt, `${field}.obtainedAt`);
    if (!obtainedAt.ok) return obtainedAt;
    const masteryTier = validateNumericEnum(
      rawEntry.masteryTier,
      MASTERY_TIERS,
      `${field}.masteryTier`,
    );
    if (!masteryTier.ok) return masteryTier;
    entries.push({
      questionId: questionId.value,
      rarity: rarity.value,
      obtainedAt: obtainedAt.value,
      masteryTier: masteryTier.value,
    });
  }
  return { ok: true, value: { entries } };
}

function validateSettings(value: unknown): Outcome<PlayerSettings> {
  if (!isRecord(value)) {
    return fail('player.settings', 'réglages non objet');
  }
  const locale = validateEnum(value.locale, LOCALE_VALUES, 'player.settings.locale');
  if (!locale.ok) return locale;
  const speechEnabled = validateBoolean(value.speechEnabled, 'player.settings.speechEnabled');
  if (!speechEnabled.ok) return speechEnabled;
  const reducedMotion = validateEnum(
    value.reducedMotion,
    REDUCED_MOTION_MODES,
    'player.settings.reducedMotion',
  );
  if (!reducedMotion.ok) return reducedMotion;
  const dailyGoal = validateNumericEnum(
    value.dailyGoalMinutes,
    DAILY_GOAL_MINUTES,
    'player.settings.dailyGoalMinutes',
  );
  if (!dailyGoal.ok) return dailyGoal;
  const confidencePrompt = validateBoolean(
    value.confidencePromptEnabled,
    'player.settings.confidencePromptEnabled',
  );
  if (!confidencePrompt.ok) return confidencePrompt;
  return {
    ok: true,
    value: {
      locale: locale.value,
      speechEnabled: speechEnabled.value,
      reducedMotion: reducedMotion.value,
      dailyGoalMinutes: dailyGoal.value,
      confidencePromptEnabled: confidencePrompt.value,
    },
  };
}

function validatePlayer(value: unknown): Outcome<PlayerState> {
  if (!isRecord(value)) {
    return fail('player', 'joueur non objet');
  }
  const profile = validateProfile(value.profile);
  if (!profile.ok) return profile;
  const totalXp = validateInteger(value.totalXp, 'player.totalXp', 0);
  if (!totalXp.ok) return totalXp;
  const streak = validateStreak(value.streak);
  if (!streak.ok) return streak;
  const badges = validateBadges(value.badges);
  if (!badges.ok) return badges;
  const questBoard = validateQuestBoard(value.questBoard);
  if (!questBoard.ok) return questBoard;
  const collection = validateCollection(value.collection);
  if (!collection.ok) return collection;
  const settings = validateSettings(value.settings);
  if (!settings.ok) return settings;
  return {
    ok: true,
    value: {
      profile: profile.value,
      totalXp: totalXp.value,
      streak: streak.value,
      badges: badges.value,
      questBoard: questBoard.value,
      collection: collection.value,
      settings: settings.value,
    },
  };
}

/**
 * Validation complète d'un document prétendant au format interne
 * `PersistedProgress` (après migrations éventuelles).
 */
function validateDocument(document: unknown, expectedVersion: number): Outcome<PersistedProgress> {
  if (!isRecord(document)) {
    return fail('', 'racine non objet');
  }
  const schemaVersion = validateInteger(document.schemaVersion, 'schemaVersion', 1);
  if (!schemaVersion.ok) return schemaVersion;
  if (schemaVersion.value !== expectedVersion) {
    return fail(
      'schemaVersion',
      `version ${schemaVersion.value} différente de la version attendue ${expectedVersion}`,
    );
  }
  const appVersion = validateString(document.appVersion, 'appVersion');
  if (!appVersion.ok) return appVersion;
  const savedAt = validateEpoch(document.savedAt, 'savedAt');
  if (!savedAt.ok) return savedAt;
  const player = validatePlayer(document.player);
  if (!player.ok) return player;
  const cards = validateCards(document.cards);
  if (!cards.ok) return cards;
  const hooks = validateHooks(document.hooks);
  if (!hooks.ok) return hooks;
  const reviewLogs = normalizeLogs(
    document.reviewLogs,
    'reviewLogs',
    MAX_REVIEW_LOG_ENTRIES,
    validateReviewLog,
    (log) => log.reviewedAt,
  );
  if (!reviewLogs.ok) return reviewLogs;
  const sessionLogs = normalizeLogs(
    document.sessionLogs,
    'sessionLogs',
    MAX_SESSION_LOG_ENTRIES,
    validateSessionLog,
    (log) => log.startedAt,
  );
  if (!sessionLogs.ok) return sessionLogs;
  const progress: PersistedProgress = {
    schemaVersion: schemaVersion.value,
    appVersion: appVersion.value,
    savedAt: savedAt.value,
    player: player.value,
    cards: cards.value,
    hooks: hooks.value,
    reviewLogs: reviewLogs.value,
    sessionLogs: sessionLogs.value,
  };
  return { ok: true, value: progress };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Fabrique du codec
 * ───────────────────────────────────────────────────────────────────────────── */

function decodeError(
  code: ProgressError['code'],
  message: string,
  details: Readonly<Record<string, string>>,
): ProgressError {
  return { code, message, details };
}

export function createProgressCodec(options: ProgressCodecOptions = {}): ProgressCodec {
  const migrations = options.migrations ?? MIGRATIONS;
  const targetVersion = options.schemaVersion ?? SCHEMA_VERSION;

  /** Routage de version + migrations + validation, sur un document déjà parsé. */
  function decodeDocument(document: unknown): ProgressDecodeResult {
    if (!isRecord(document)) {
      return { ok: false, error: decodeError('invalid-shape', 'racine non objet', { field: '' }) };
    }
    const rawVersion = document.schemaVersion;
    if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 0) {
      return {
        ok: false,
        error: decodeError('invalid-shape', 'schemaVersion absente ou invalide', {
          field: 'schemaVersion',
        }),
      };
    }
    // Une donnée écrite par une version plus récente n'est ni migrée ni
    // écrasée : l'appelant doit proposer la mise à jour de l'application.
    if (rawVersion > MAX_SUPPORTED_SCHEMA_VERSION) {
      return {
        ok: false,
        error: decodeError(
          'future-version',
          `schéma ${rawVersion} postérieur au support (${MAX_SUPPORTED_SCHEMA_VERSION})`,
          { version: String(rawVersion) },
        ),
      };
    }
    if (rawVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
      return {
        ok: false,
        error: decodeError(
          'unsupported-version',
          `schéma ${rawVersion} antérieur au support minimal (${MIN_SUPPORTED_SCHEMA_VERSION})`,
          { version: String(rawVersion) },
        ),
      };
    }
    let working: unknown = document;
    const migratedFrom = rawVersion === targetVersion ? null : rawVersion;
    for (let version = rawVersion; version < targetVersion; version += 1) {
      const migration = migrations.find((entry) => entry.fromVersion === version) ?? null;
      if (migration === null || migration.toVersion !== version + 1) {
        return {
          ok: false,
          error: decodeError('missing-migration', `aucune migration ${version} → ${version + 1}`, {
            version: String(version),
          }),
        };
      }
      try {
        working = migration.migrate(working);
      } catch (error) {
        return {
          ok: false,
          error: decodeError(
            'invalid-shape',
            `migration ${version} → ${version + 1} échouée : ${error instanceof Error ? error.message : String(error)}`,
            { version: String(version) },
          ),
        };
      }
    }
    const validated = validateDocument(working, targetVersion);
    if (!validated.ok) {
      return validated;
    }
    return { ok: true, progress: validated.value, migratedFrom };
  }

  return {
    encode(progress: PersistedProgress): string {
      return stableStringify(progress);
    },

    decode(raw: string): ProgressDecodeResult {
      let document: unknown;
      try {
        document = JSON.parse(raw);
      } catch (error) {
        return {
          ok: false,
          error: decodeError(
            'invalid-json',
            `JSON illisible : ${error instanceof Error ? error.message : String(error)}`,
            {},
          ),
        };
      }
      return decodeDocument(document);
    },

    toExport(progress: PersistedProgress, now: EpochMs): ExportEnvelope {
      return {
        format: EXPORT_FORMAT,
        formatVersion: EXPORT_FORMAT_VERSION,
        exportedAt: isoFromEpoch(now),
        progress,
      };
    },

    fromExport(raw: string): ProgressImportResult {
      let envelope: unknown;
      try {
        envelope = JSON.parse(raw);
      } catch (error) {
        return {
          ok: false,
          error: decodeError(
            'invalid-json',
            `JSON illisible : ${error instanceof Error ? error.message : String(error)}`,
            {},
          ),
        };
      }
      if (!isRecord(envelope)) {
        return {
          ok: false,
          error: decodeError('invalid-shape', 'enveloppe non objet', { field: '' }),
        };
      }
      // L'enveloppe d'export est un format public distinct : `decode` interne
      // n'accepte jamais une enveloppe, `fromExport` jamais un état nu.
      const format = validateString(envelope.format, 'format');
      if (!format.ok) return format;
      if (format.value !== EXPORT_FORMAT) {
        return {
          ok: false,
          error: decodeError('invalid-shape', `format d’export inconnu : ${format.value}`, {
            field: 'format',
          }),
        };
      }
      const formatVersion = validateInteger(envelope.formatVersion, 'formatVersion', 1);
      if (!formatVersion.ok) return formatVersion;
      if (formatVersion.value !== EXPORT_FORMAT_VERSION) {
        return {
          ok: false,
          error: decodeError(
            'invalid-shape',
            `version de format d’export non supportée : ${formatVersion.value}`,
            { field: 'formatVersion' },
          ),
        };
      }
      const exportedAt = validateString(envelope.exportedAt, 'exportedAt');
      if (!exportedAt.ok) return exportedAt;
      if (!ISO_DATETIME_PATTERN.test(exportedAt.value)) {
        return {
          ok: false,
          error: decodeError('invalid-shape', `horodatage d’export non ISO : ${exportedAt.value}`, {
            field: 'exportedAt',
          }),
        };
      }
      const progressField = requiredField(envelope, 'progress');
      if (!progressField.ok) return progressField;
      return decodeDocument(progressField.value);
    },
  };
}

function isoFromEpoch(at: EpochMs): IsoDateTime {
  return new Date(at).toISOString();
}

/** Instance standard de l'application (registre et version gelés du contrat). */
export const progressCodec: ProgressCodec = createProgressCodec();
