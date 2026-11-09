import type { PersonalHook } from '@/domain/memory/types';
import type { QuestionCatalog, QuestionItem } from '@/domain/questions/types';
import { DRILL_DIRECTIONS, NUMERIC_BOUNDS } from '@/domain/shared/types';
import type { ActId, DrillDirection, LocalizedText, QuestionId } from '@/domain/shared/types';
import type { CardState, ReviewLog } from '@/domain/srs/types';

import { createPrng } from './prng';
import type { Prng } from './prng';
import { DEFAULT_SESSION_LIMITS } from './types';
import type {
  DiscriminationOption,
  DiscriminationSessionItem,
  Hint,
  HintKind,
  HintPolicy,
  InterleavingDescriptor,
  InterleavingPolicy,
  ProductionSessionItem,
  SessionBuildContext,
  SessionBuildResult,
  SessionConfig,
  SessionItem,
  SessionMode,
  SessionPlan,
  SessionRequest,
  SessionBuilder,
} from './types';

/**
 * Construction déterministe d'un plan de session (L1, L3, L4, L5, L9, L16, L18).
 *
 * Ordre d'application (docs/ARCHITECTURE.md §7.2) :
 *  1. validation et plafonds L3 (`maxItems`, `maxDurationMs`) ;
 *  2. filtres (actes débloqués, actes/questions demandés, mode) ;
 *  3. garde L15 (mode `speed` refusé tant que l'acte n'est pas maîtrisé) ;
 *  4. sélection reproductible et directions L16 ;
 *  5. entrelacement L4 ;
 *  6. indices L9 et prétest L18 ;
 *  7. discrimination plafonnée, interdite en mode examen (L1).
 *
 * Aucune exception n'est levée : toute configuration impossible produit un
 * `SessionBuildResult` en échec explicite.
 */

/** Réglages par défaut dérivés du mode (docs/ARCHITECTURE.md §7.5). */
interface ModeDefaults {
  readonly interleaving: InterleavingPolicy;
  readonly hintPolicy: HintPolicy;
  readonly requiresConfidence: boolean;
  readonly speedTargetMs: number | null;
  readonly maxItems: number | null;
  readonly maxDurationMs: number | null;
  /** Directions imposées par le mode ; `null` = les cinq directions. */
  readonly directions: readonly DrillDirection[] | null;
  /** Mode « examen » : aucune discrimination admise (L1, L15). */
  readonly productionOnly: boolean;
}

const MODE_DEFAULTS: Readonly<Record<SessionMode, ModeDefaults>> = {
  discovery: {
    interleaving: 'blocked',
    hintPolicy: 'progressive',
    requiresConfidence: false,
    speedTargetMs: null,
    maxItems: null,
    maxDurationMs: null,
    directions: null,
    productionOnly: false,
  },
  learning: {
    interleaving: 'directions',
    hintPolicy: 'on-demand',
    requiresConfidence: false,
    speedTargetMs: null,
    maxItems: null,
    maxDurationMs: null,
    directions: null,
    productionOnly: false,
  },
  review: {
    interleaving: 'acts-and-directions',
    hintPolicy: 'on-demand',
    requiresConfidence: true,
    speedTargetMs: null,
    maxItems: null,
    maxDurationMs: null,
    directions: null,
    productionOnly: false,
  },
  recitation: {
    interleaving: 'blocked',
    hintPolicy: 'on-demand',
    requiresConfidence: false,
    speedTargetMs: null,
    // Récitation libre : les trois actes (36 items) par défaut ; l'acte demandé
    // limite la sélection à ses 12 items. 20 min de budget ⇒ 40 productions.
    maxItems: 36,
    maxDurationMs: 20 * 60 * 1000,
    directions: ['order-to-question'],
    productionOnly: true,
  },
  speed: {
    interleaving: 'directions',
    hintPolicy: 'on-demand',
    requiresConfidence: false,
    speedTargetMs: 4_000,
    maxItems: null,
    maxDurationMs: null,
    directions: null,
    productionOnly: false,
  },
  'grand-oral': {
    interleaving: 'acts-and-directions',
    hintPolicy: 'disabled',
    requiresConfidence: true,
    speedTargetMs: null,
    maxItems: 36,
    maxDurationMs: 20 * 60 * 1000,
    directions: null,
    productionOnly: true,
  },
};

/** Ordre canonique du retrait progressif des aides (L9). */
const HINT_LADDER: readonly HintKind[] = [
  'initials',
  'first-words',
  'keyword',
  'mental-image',
  'personal-hook',
  'full-answer',
];

const DRILL_DIRECTION_SET: ReadonlySet<string> = new Set(DRILL_DIRECTIONS);

const ALL_ACTS: readonly ActId[] = [1, 2, 3];

interface DirectionalQuestion {
  readonly question: QuestionItem;
  direction: DrillDirection;
}

interface ItemCommonFields {
  readonly id: string;
  readonly questionId: QuestionId;
  readonly actId: ActId;
  readonly mentalImage: LocalizedText;
  readonly hints: readonly Hint[];
  readonly isPretest: boolean;
}

interface DiscriminationCommonFields extends ItemCommonFields {
  readonly exerciseKind: 'discrimination';
  readonly options: readonly DiscriminationOption[];
  readonly correctOptionId: string;
}

function isDrillDirection(value: string): value is DrillDirection {
  return DRILL_DIRECTION_SET.has(value);
}

function isQuestionId(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= NUMERIC_BOUNDS.questionId.inclusiveMin &&
    value <= NUMERIC_BOUNDS.questionId.inclusiveMax
  );
}

function isActId(value: number): boolean {
  return ALL_ACTS.some((actId) => actId === value);
}

function localized(fr: string, en: string | undefined): LocalizedText {
  return en === undefined ? { fr } : { fr, en };
}

/** Résout les directions autorisées en croisant requête et mode (§7.2, §7.5). */
function resolveDirections(
  request: SessionRequest,
  defaults: ModeDefaults,
): readonly DrillDirection[] | null {
  const requested = request.directions;
  if (requested !== undefined) {
    if (requested.length === 0) {
      return null;
    }
    for (const direction of requested) {
      if (!isDrillDirection(direction)) {
        return null;
      }
    }
    const unique = [...new Set(requested)];
    if (defaults.directions !== null) {
      const forced = new Set(defaults.directions);
      const intersection = unique.filter((direction) => forced.has(direction));
      return intersection.length === 0 ? null : intersection;
    }
    return unique;
  }
  if (defaults.directions !== null) {
    return defaults.directions;
  }
  return [...DRILL_DIRECTIONS];
}

/** Deux dernières directions produites par question, d'après le journal récent. */
function lastTwoDirectionsByQuestion(
  logs: readonly ReviewLog[],
): ReadonlyMap<QuestionId, readonly DrillDirection[]> {
  const sorted = logs.slice().sort((left, right) => left.reviewedAt - right.reviewedAt);
  const byQuestion = new Map<QuestionId, DrillDirection[]>();
  for (const log of sorted) {
    const list = byQuestion.get(log.questionId) ?? [];
    list.push(log.direction);
    byQuestion.set(log.questionId, list);
  }
  const result = new Map<QuestionId, readonly DrillDirection[]>();
  for (const [questionId, list] of byQuestion) {
    result.set(questionId, list.slice(-2));
  }
  return result;
}

/** Choisit une direction en évitant les deux dernières révisions de la question. */
function pickDirection(
  questionId: QuestionId,
  index: number,
  allowed: readonly DrillDirection[],
  lastTwo: ReadonlyMap<QuestionId, readonly DrillDirection[]>,
  prng: Prng,
): DrillDirection {
  const fallback = allowed[index % allowed.length] ?? allowed[0];
  if (fallback === undefined) {
    throw new Error('buildSession : aucune direction autorisée.');
  }
  const recent = new Set(lastTwo.get(questionId) ?? []);
  if (!recent.has(fallback)) {
    return fallback;
  }
  const alternatives = allowed.filter((direction) => !recent.has(direction));
  if (alternatives.length === 0) {
    return fallback;
  }
  const offset = prng.nextInt(0, alternatives.length);
  return alternatives[offset] ?? fallback;
}

/**
 * Garantit que sur une sélection d'au moins `allowed.length` items, chaque
 * direction autorisée est représentée au moins une fois (§7.2, étape 3).
 */
function ensureDirectionCoverage(
  assignments: DirectionalQuestion[],
  allowed: readonly DrillDirection[],
): void {
  if (assignments.length < allowed.length) {
    return;
  }
  const used = new Set(assignments.map((entry) => entry.direction));
  const missing = allowed.filter((direction) => !used.has(direction));
  if (missing.length === 0) {
    return;
  }
  let cursor = 0;
  for (const direction of missing) {
    let placed = false;
    for (let step = 0; step < assignments.length && !placed; step += 1) {
      const index = (cursor + step) % assignments.length;
      const entry = assignments[index];
      if (entry === undefined) {
        continue;
      }
      const occurrences = assignments.filter(
        (candidate) => candidate.direction === entry.direction,
      ).length;
      if (occurrences > 1) {
        used.delete(entry.direction);
        entry.direction = direction;
        used.add(direction);
        cursor = index + 1;
        placed = true;
      }
    }
    if (!placed) {
      const index = cursor % assignments.length;
      const entry = assignments[index];
      if (entry !== undefined) {
        entry.direction = direction;
        used.add(direction);
        cursor = index + 1;
      }
    }
  }
}

/** Groupe les items par acte, actes croissants, ordre d'affectation conservé. */
function groupByAct(
  assignments: readonly DirectionalQuestion[],
): { actId: ActId; entries: DirectionalQuestion[] }[] {
  const buckets = new Map<ActId, DirectionalQuestion[]>();
  for (const entry of assignments) {
    const bucket = buckets.get(entry.question.actId) ?? [];
    bucket.push(entry);
    buckets.set(entry.question.actId, bucket);
  }
  return [...buckets.keys()]
    .sort((left, right) => left - right)
    .map((actId) => ({ actId, entries: buckets.get(actId) ?? [] }));
}

/** Alterne les directions à l'intérieur d'un groupe (round-robin). */
function spreadByDirection(
  entries: readonly DirectionalQuestion[],
  allowed: readonly DrillDirection[],
): DirectionalQuestion[] {
  const buckets = new Map<DrillDirection, DirectionalQuestion[]>();
  for (const direction of allowed) {
    buckets.set(direction, []);
  }
  for (const entry of entries) {
    buckets.get(entry.direction)?.push(entry);
  }
  const result: DirectionalQuestion[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const direction of allowed) {
      const next = buckets.get(direction)?.shift();
      if (next !== undefined) {
        result.push(next);
        added = true;
      }
    }
  }
  return result;
}

/** Entrelace les actes en évitant deux actes identiques consécutifs (§7.2, L4). */
function interleaveActsAndDirections(
  assignments: readonly DirectionalQuestion[],
  allowed: readonly DrillDirection[],
): DirectionalQuestion[] {
  const groups = groupByAct(assignments).map((group) => ({
    actId: group.actId,
    entries: spreadByDirection(group.entries, allowed),
  }));
  const result: DirectionalQuestion[] = [];
  let previousAct: ActId | null = null;
  while (result.length < assignments.length) {
    let chosenIndex = -1;
    let bestSize = -1;
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      if (group === undefined || group.entries.length === 0) {
        continue;
      }
      if (previousAct !== null && group.actId === previousAct) {
        continue;
      }
      if (group.entries.length > bestSize) {
        chosenIndex = index;
        bestSize = group.entries.length;
      }
    }
    if (chosenIndex === -1) {
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        if (group !== undefined && group.entries.length > bestSize) {
          chosenIndex = index;
          bestSize = group.entries.length;
        }
      }
    }
    const chosen = groups[chosenIndex];
    const next = chosen?.entries.shift();
    if (chosen === undefined || next === undefined) {
      break;
    }
    result.push(next);
    previousAct = chosen.actId;
  }
  return result;
}

/** Ordonne les items selon la politique d'entrelacement (L4). */
function orderAssignments(
  assignments: readonly DirectionalQuestion[],
  policy: InterleavingPolicy,
  allowed: readonly DrillDirection[],
): DirectionalQuestion[] {
  if (policy === 'blocked') {
    return assignments.slice().sort((left, right) => left.question.actId - right.question.actId);
  }
  if (policy === 'directions') {
    return groupByAct(assignments).flatMap((group) => spreadByDirection(group.entries, allowed));
  }
  return interleaveActsAndDirections(assignments, allowed);
}

/** Premières lettres de chaque mot, pour l'indice `initials`. */
function firstLetters(text: string): string {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map((word) => (word.charAt(0) || '').toUpperCase()).join(' ');
}

/** Premiers mots d'une formulation, pour l'indice `first-words`. */
function firstWords(text: string, count = 3): string {
  const words = text.split(/\s+/u).filter((word) => word.length > 0);
  if (words.length <= count) {
    return text;
  }
  return `${words.slice(0, count).join(' ')}…`;
}

/** Construit un indice d'un niveau donné, ou `null` si le niveau est indisponible. */
function buildHint(
  kind: HintKind,
  question: QuestionItem,
  direction: DrillDirection,
  hook: PersonalHook | null,
): Hint | null {
  switch (kind) {
    case 'initials': {
      const fr = firstLetters(question.prompt.fr);
      if (fr.length === 0) {
        return null;
      }
      const en = question.prompt.en === undefined ? undefined : firstLetters(question.prompt.en);
      return { kind, content: localized(fr, en) };
    }
    case 'first-words': {
      const en = question.prompt.en === undefined ? undefined : firstWords(question.prompt.en);
      return { kind, content: localized(firstWords(question.prompt.fr), en) };
    }
    case 'keyword':
      return { kind, content: question.keyword };
    case 'mental-image':
      return { kind, content: question.mentalImage };
    case 'personal-hook':
      return hook === null ? null : { kind, content: { fr: hook.text } };
    case 'full-answer':
      return {
        kind,
        content: direction === 'question-to-number' ? { fr: String(question.id) } : question.prompt,
      };
  }
}

/**
 * Construit le plan d'indices ordonné du plus faible au plus fort (L9).
 *
 * Interprétation des politiques au niveau du plan :
 * - `disabled`   : aucun indice (`[]`) ;
 * - `on-demand`  : échelle complète sauf `full-answer`, révélée un par un ;
 * - `progressive`: échelle complète, `full-answer` inclus comme aide ultime,
 *                  que la couche application peut révéler automatiquement après
 *                  un échec.
 */
function buildHints(
  question: QuestionItem,
  direction: DrillDirection,
  policy: HintPolicy,
  hook: PersonalHook | null,
): readonly Hint[] {
  if (policy === 'disabled') {
    return [];
  }
  const includeFullAnswer = policy === 'progressive';
  const hints: Hint[] = [];
  for (const kind of HINT_LADDER) {
    if (kind === 'full-answer' && !includeFullAnswer) {
      continue;
    }
    const hint = buildHint(kind, question, direction, hook);
    if (hint !== null) {
      hints.push(hint);
    }
  }
  return hints;
}

/** Construit un item de production avec l'appariement direction → indice vérifié. */
function buildProductionItem(
  question: QuestionItem,
  direction: DrillDirection,
  common: ItemCommonFields,
): ProductionSessionItem {
  switch (direction) {
    case 'order-to-question':
      return {
        ...common,
        exerciseKind: 'production',
        direction,
        cue: { kind: 'order', actId: question.actId, positionInAct: question.positionInAct },
        expectedAnswer: { kind: 'question', text: question.prompt },
      };
    case 'keyword-to-question':
      return {
        ...common,
        exerciseKind: 'production',
        direction,
        cue: { kind: 'keyword', text: question.keyword },
        expectedAnswer: { kind: 'question', text: question.prompt },
      };
    case 'image-to-question':
      return {
        ...common,
        exerciseKind: 'production',
        direction,
        cue: { kind: 'image', text: question.mentalImage },
        expectedAnswer: { kind: 'question', text: question.prompt },
      };
    case 'number-to-question':
      return {
        ...common,
        exerciseKind: 'production',
        direction,
        cue: { kind: 'number', questionNumber: question.id },
        expectedAnswer: { kind: 'question', text: question.prompt },
      };
    case 'question-to-number':
      return {
        ...common,
        exerciseKind: 'production',
        direction,
        cue: { kind: 'question', text: question.prompt },
        expectedAnswer: { kind: 'number', questionNumber: question.id },
      };
  }
}

function optionId(questionId: QuestionId): string {
  return `question:${questionId}`;
}

function optionLabel(
  questionId: QuestionId,
  direction: DrillDirection,
  catalog: QuestionCatalog,
): LocalizedText {
  const question = catalog.byId.get(questionId);
  if (question === undefined) {
    return { fr: String(questionId) };
  }
  return direction === 'question-to-number' ? { fr: String(question.id) } : question.prompt;
}

/** Un item n'est éligible à la discrimination que s'il a déjà été rencontré. */
function isEncountered(questionId: QuestionId, cards: ReadonlyMap<QuestionId, CardState>): boolean {
  const card = cards.get(questionId);
  return card !== undefined && card.reps > 0;
}

/** Convertit un item de production en QCM de discrimination (4 options, 1 correcte). */
function toDiscriminationItem(
  item: ProductionSessionItem,
  catalog: QuestionCatalog,
  prng: Prng,
): DiscriminationSessionItem {
  const distractors = prng
    .shuffle(
      catalog.questions.filter(
        (question) => question.actId === item.actId && question.id !== item.questionId,
      ),
    )
    .slice(0, 3);
  const correctOptionId = optionId(item.questionId);
  const options = prng.shuffle([
    {
      id: correctOptionId,
      questionId: item.questionId,
      label: optionLabel(item.questionId, item.direction, catalog),
    },
    ...distractors.map((question) => ({
      id: optionId(question.id),
      questionId: question.id,
      label: optionLabel(question.id, item.direction, catalog),
    })),
  ]);
  const common: DiscriminationCommonFields = {
    id: item.id,
    questionId: item.questionId,
    actId: item.actId,
    mentalImage: item.mentalImage,
    hints: item.hints,
    isPretest: item.isPretest,
    exerciseKind: 'discrimination',
    options,
    correctOptionId,
  };
  switch (item.direction) {
    case 'order-to-question':
      return {
        ...common,
        direction: 'order-to-question',
        cue: item.cue,
        expectedAnswer: item.expectedAnswer,
      };
    case 'keyword-to-question':
      return {
        ...common,
        direction: 'keyword-to-question',
        cue: item.cue,
        expectedAnswer: item.expectedAnswer,
      };
    case 'image-to-question':
      return {
        ...common,
        direction: 'image-to-question',
        cue: item.cue,
        expectedAnswer: item.expectedAnswer,
      };
    case 'number-to-question':
      return {
        ...common,
        direction: 'number-to-question',
        cue: item.cue,
        expectedAnswer: item.expectedAnswer,
      };
    case 'question-to-number':
      return {
        ...common,
        direction: 'question-to-number',
        cue: item.cue,
        expectedAnswer: item.expectedAnswer,
      };
  }
}

/**
 * Applique le plafond de discrimination : jamais plus de 20 % des items (L4).
 *
 * Un mode « examen » (`productionOnly`) n'accepte **aucune** discrimination :
 * `recitation` et `grand-oral` mesurent la restitution réelle, pas la
 * reconnaissance. Le plafond de 20 % ne vaut donc que pour les modes qui
 * autorisent le drill de discrimination.
 */
function applyDiscrimination(
  items: readonly SessionItem[],
  config: SessionConfig,
  context: SessionBuildContext,
  prng: Prng,
): SessionItem[] {
  if (config.productionOnly) {
    return items.slice();
  }
  const limit = Math.floor(items.length * config.maxDiscriminationRatio);
  if (limit < 1) {
    return items.slice();
  }
  const eligible = items
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        item.exerciseKind === 'production' &&
        !item.isPretest &&
        isEncountered(item.questionId, context.cards),
    );
  if (eligible.length === 0) {
    return items.slice();
  }
  const chosen = new Set(
    prng
      .shuffle(eligible)
      .slice(0, Math.min(limit, eligible.length))
      .map((entry) => entry.index),
  );
  return items.map((item, index) =>
    chosen.has(index) && item.exerciseKind === 'production'
      ? toDiscriminationItem(item, context.catalog, prng)
      : item,
  );
}

/** Récapitulatif vérifiable de l'ordre produit (L4). */
function describeInterleaving(
  policy: InterleavingPolicy,
  items: readonly SessionItem[],
): InterleavingDescriptor {
  const directionCounts: Record<DrillDirection, number> = {
    'order-to-question': 0,
    'keyword-to-question': 0,
    'image-to-question': 0,
    'number-to-question': 0,
    'question-to-number': 0,
  };
  for (const item of items) {
    directionCounts[item.direction] += 1;
  }
  const productionCount = items.filter((item) => item.exerciseKind === 'production').length;
  return {
    policy,
    actSequence: items.map((item) => item.actId),
    directionSequence: items.map((item) => item.direction),
    directionCounts,
    productionCount,
    discriminationCount: items.length - productionCount,
  };
}

function findHook(hooks: readonly PersonalHook[], questionId: QuestionId): PersonalHook | null {
  return hooks.find((hook) => hook.questionId === questionId) ?? null;
}

/** Construit un plan de session ou renvoie un échec explicite. */
export function buildSession(
  request: SessionRequest,
  context: SessionBuildContext,
): SessionBuildResult {
  const defaults = MODE_DEFAULTS[request.mode];
  const invalidConfig: SessionBuildResult = { ok: false, failure: 'invalid-config' };

  // ── 1. Validation de la configuration ───────────────────────────────────
  const maxItems = request.maxItems ?? defaults.maxItems ?? DEFAULT_SESSION_LIMITS.maxItems;
  if (!Number.isInteger(maxItems) || maxItems < 1) {
    return invalidConfig;
  }
  const maxDurationMs =
    request.maxDurationMs ?? defaults.maxDurationMs ?? DEFAULT_SESSION_LIMITS.maxDurationMs;
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    return invalidConfig;
  }
  const allowedDirections = resolveDirections(request, defaults);
  if (allowedDirections === null) {
    return invalidConfig;
  }
  if (request.actIds !== undefined && request.actIds.some((actId) => !isActId(actId))) {
    return invalidConfig;
  }
  if (request.questionIds !== undefined && request.questionIds.some((id) => !isQuestionId(id))) {
    return invalidConfig;
  }

  // ── 2. Plafond de durée L3 (coût estimé d'un item de production) ────────
  const durationCap = Math.floor(maxDurationMs / DEFAULT_SESSION_LIMITS.productionItemMs);
  if (durationCap < 1) {
    return invalidConfig;
  }

  // ── 3. Filtres : actes débloqués, actes/questions demandés ──────────────
  const unlocked = new Set<ActId>(context.unlockedActIds);
  if (request.actIds !== undefined) {
    for (const actId of request.actIds) {
      if (!unlocked.has(actId)) {
        return { ok: false, failure: 'act-locked' };
      }
    }
  }
  const requestedActs = request.actIds === undefined ? null : new Set(request.actIds);
  const requestedQuestions =
    request.questionIds === undefined ? null : new Set(request.questionIds);

  const baseFiltered = context.catalog.questions
    .filter((question) => unlocked.has(question.actId))
    .filter((question) => requestedActs === null || requestedActs.has(question.actId))
    .filter((question) => requestedQuestions === null || requestedQuestions.has(question.id))
    .slice()
    .sort((left, right) => left.id - right.id);

  if (baseFiltered.length === 0) {
    return { ok: false, failure: 'empty-selection' };
  }

  // ── 3. Garde L15 : le drill de vitesse exige un acte maîtrisé ────────────
  if (request.mode === 'speed') {
    const mastered = new Set<ActId>(context.masteredActIds);
    const targetedActs =
      requestedActs === null
        ? [...new Set(baseFiltered.map((question) => question.actId))]
        : [...requestedActs];
    if (targetedActs.some((actId) => !mastered.has(actId))) {
      return { ok: false, failure: 'mode-locked' };
    }
  }

  const isDue = (questionId: QuestionId): boolean => {
    const card = context.cards.get(questionId);
    return card !== undefined && card.dueAt <= request.now;
  };
  const isNew = (questionId: QuestionId): boolean => {
    const card = context.cards.get(questionId);
    return card === undefined || card.phase === 'new' || card.reps === 0;
  };
  const filtered = baseFiltered.filter((question) => {
    if (request.mode === 'review') {
      return isDue(question.id);
    }
    if (request.mode === 'discovery') {
      return isNew(question.id);
    }
    return true;
  });

  if (filtered.length === 0) {
    return { ok: false, failure: request.mode === 'review' ? 'no-due-cards' : 'empty-selection' };
  }

  // ── 4. Sélection aléatoire reproductible ────────────────────────────────
  const prng = createPrng(request.seed);
  const pool = prng.shuffle(filtered);
  const target = Math.min(maxItems, durationCap, pool.length);
  const selected = pool.slice(0, target);

  // ── 5. Directions L16 + couverture des cinq directions ──────────────────
  const lastTwo = lastTwoDirectionsByQuestion(context.recentLogs);
  const assignments: DirectionalQuestion[] = selected.map((question, index) => ({
    question,
    direction: pickDirection(question.id, index, allowedDirections, lastTwo, prng),
  }));
  ensureDirectionCoverage(assignments, allowedDirections);

  const config: SessionConfig = {
    mode: request.mode,
    maxItems,
    maxDurationMs,
    directions: allowedDirections,
    interleaving: defaults.interleaving,
    hintPolicy: defaults.hintPolicy,
    maxDiscriminationRatio: defaults.productionOnly
      ? 0
      : Math.min(DEFAULT_SESSION_LIMITS.maxDiscriminationRatio, 0.2),
    productionOnly: defaults.productionOnly,
    requiresConfidence: defaults.requiresConfidence,
    speedTargetMs: defaults.speedTargetMs,
  };

  // ── 6. Entrelacement L4 ─────────────────────────────────────────────────
  const ordered = orderAssignments(assignments, config.interleaving, allowedDirections);

  // ── 7. Construction des items : indices L9 et prétest L18 ───────────────
  const seenQuestions = new Set<QuestionId>();
  const productionItems: SessionItem[] = ordered.map((entry, index) => {
    const { question } = entry;
    const isPretest = request.mode === 'discovery' && !seenQuestions.has(question.id);
    seenQuestions.add(question.id);
    return buildProductionItem(question, entry.direction, {
      id: `${request.sessionId}:${index}`,
      questionId: question.id,
      actId: question.actId,
      mentalImage: question.mentalImage,
      hints: buildHints(
        question,
        entry.direction,
        config.hintPolicy,
        findHook(context.hooks, question.id),
      ),
      isPretest,
    });
  });

  // ── 7. Discrimination plafonnée, interdite en mode examen ───────────────
  const items = applyDiscrimination(productionItems, config, context, prng);

  const plan: SessionPlan = {
    id: request.sessionId,
    mode: request.mode,
    seed: request.seed,
    createdAt: request.now,
    config,
    items,
    interleaving: describeInterleaving(config.interleaving, items),
    dueQuestionIds: request.mode === 'review' ? items.map((item) => item.questionId) : [],
  };

  return { ok: true, plan };
}

/** Implémentation par défaut, sans état, du constructeur de plan. */
export const sessionBuilder: SessionBuilder = { build: buildSession };
