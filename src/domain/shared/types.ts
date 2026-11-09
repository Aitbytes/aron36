/**
 * Vocabulaire partagé du domaine Aron 36.
 *
 * Ce fichier ne contient que des types et des constantes de contrat : aucune
 * fonction, aucun accès au DOM, aucune horloge implicite. Tous les modules du
 * domaine peuvent l'importer ; il n'importe rien.
 */

/*
 * Note sur les unités (décision ADR 0009).
 *
 * `EpochMs`, `DurationMs`, `Days`, `Minutes`, `Ratio` et `Percentage` sont des
 * types *nominaux par documentation* : le système de types ne les distingue pas
 * d'un `number` nu. La confusion d'unités (ms vs jours) est le risque d'erreur
 * le plus coûteux d'un ordonnanceur espacé, mais des types brandés imposeraient
 * des conversions dans tout le domaine, pour un gain nul à l'exécution.
 *
 * Contrepartie obligatoire : toute valeur numérique qui franchit la frontière
 * du domaine (lecture de stockage, import JSON, saisie utilisateur, retour de
 * port) DOIT être validée à l'exécution contre `NUMERIC_BOUNDS`, et tout champ
 * d'unité DOIT être nommé avec son unité (`dueAt`, `intervalDays`, `…Ms`).
 */

/** Millisecondes écoulées depuis l'époque Unix (1970-01-01T00:00:00Z). */
export type EpochMs = number;

/** Durée exprimée en millisecondes (toujours ≥ 0). */
export type DurationMs = number;

/** Durée exprimée en jours (peut être fractionnaire : 10 min = 10 / 1440 j). */
export type Days = number;

/** Durée exprimée en minutes (toujours ≥ 0). */
export type Minutes = number;

/**
 * Jour civil local au format `YYYY-MM-DD`.
 *
 * Les frontières de journée (séries, quêtes, rappels du soir) sont calculées
 * par `ClockPort.dayKey()` dans le fuseau de l'utilisateur, jamais par le
 * domaine lui-même.
 */
export type DayKey = string;

/** Identifiant d'une question : entier de 1 à 36 inclus. */
export type QuestionId = number;

/** Identifiant d'un acte : 1, 2 ou 3. */
export type ActId = 1 | 2 | 3;

/** Rang d'une question à l'intérieur de son acte : entier de 1 à 12 inclus. */
export type PositionInAct = number;

/** Locale de l'interface et du contenu. Le français est la locale par défaut. */
export type LocaleCode = 'fr' | 'en';

/**
 * Texte localisé. `fr` est toujours présent (locale par défaut et de repli) ;
 * `en` est optionnel tant que la traduction anglaise n'est pas validée.
 */
export interface LocalizedText {
  readonly fr: string;
  readonly en?: string;
}

/** Ratio sans unité, borné à [0, 1]. */
export type Ratio = number;

/** Pourcentage sans unité, borné à [0, 100]. */
export type Percentage = number;

/** Graine déterministe d'un tirage pseudo-aléatoire (portée par une session). */
export type RandomSeed = string;

/** Identifiant opaque d'une session d'entraînement. */
export type SessionId = string;

/** Identifiant opaque d'une réponse d'entraînement (une ligne de `ReviewLog`). */
export type ReviewLogId = string;

/** Date ISO 8601 complète, réservée aux exports et aux métadonnées. */
export type IsoDateTime = string;

/** Nombre total de questions du protocole d'Aron et al. (1997). */
export const QUESTION_COUNT = 36;

/** Nombre d'actes du protocole. */
export const ACT_COUNT = 3;

/** Nombre de questions par acte. */
export const QUESTIONS_PER_ACT = 12;

/** Premier identifiant de question. */
export const FIRST_QUESTION_ID = 1;

/** Dernier identifiant de question. */
export const LAST_QUESTION_ID = QUESTION_COUNT;

/** Identifiants d'actes, dans l'ordre de passation. */
export const ACT_IDS = [1, 2, 3] as const satisfies readonly ActId[];

/** Millisecondes dans une minute. */
export const MINUTE_MS = 60_000;

/** Millisecondes dans une heure. */
export const HOUR_MS = 3_600_000;

/** Millisecondes dans une journée de 24 h (arithmétique, hors fuseau/DST). */
export const DAY_MS = 86_400_000;

/** Bornes des quatre fenêtres de journée utilisées par L17, en heures locales. */
export const SESSION_WINDOW_HOURS = {
  morningStart: 5,
  dayStart: 12,
  eveningStart: 19,
  nightStart: 23,
} as const;

/**
 * Les cinq directions de drill imposées par le mécanisme L16.
 *
 * - `order-to-question` : position dans l'acte (1..12) → question ;
 * - `keyword-to-question` : mot-clé → question ;
 * - `image-to-question` : image mentale → question ;
 * - `number-to-question` : numéro global (1..36) → question ;
 * - `question-to-number` : question → numéro global.
 */
export const DRILL_DIRECTIONS = [
  'order-to-question',
  'keyword-to-question',
  'image-to-question',
  'number-to-question',
  'question-to-number',
] as const;

/** Direction de drill (union fermée des cinq directions de L16). */
export type DrillDirection = (typeof DRILL_DIRECTIONS)[number];

/** Les quatre notes de rappel, ordonnées de l'échec à la réussite facile. */
export const REVIEW_GRADES = ['again', 'hard', 'good', 'easy'] as const;

/** Note auto-évaluée après révélation de la réponse. */
export type ReviewGrade = (typeof REVIEW_GRADES)[number];

/**
 * Nature de l'exercice.
 *
 * - `production` : l'apprenant restitue la question sans support (L1, L8) ;
 * - `discrimination` : choix entre plusieurs réponses, minoritaire et étiqueté
 *   comme tel. Ne doit jamais être présenté comme un test de rappel.
 */
export const EXERCISE_KINDS = ['production', 'discrimination'] as const;

/** Nature d'un exercice (union fermée). */
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

/** Niveau de confiance déclaré avant révélation (échelle de Likert 1..5). */
export type ConfidenceRating = 1 | 2 | 3 | 4 | 5;

/** Échelle complète des jugements de confiance, dans l'ordre. */
export const CONFIDENCE_RATINGS = [1, 2, 3, 4, 5] as const satisfies readonly ConfidenceRating[];

/**
 * Notes qui comptent comme un **rappel réussi**.
 *
 * Définit `SessionAnswer.isCorrect` : `isCorrect === (grade !== 'again')`.
 * C'est la seule définition de « réponse correcte » du projet ; toute mesure de
 * précision (`accuracy`, `correctCount`, badges de précision, quêtes) en dérive.
 */
export const CORRECT_GRADES = ['hard', 'good', 'easy'] as const satisfies readonly ReviewGrade[];

/**
 * Crédit de réussite par note, dans [0, 1].
 *
 * Utilisé pour les mesures de précision pondérées : un rappel difficile (`hard`)
 * est un succès réel mais partiel. `accuracy` = moyenne de ce crédit.
 * `again` vaut 0 ; une carte ne chute que sur `again`.
 */
export const ACCURACY_CREDIT = {
  again: 0,
  hard: 0.5,
  good: 1,
  easy: 1,
} as const satisfies Readonly<Record<ReviewGrade, number>>;

/**
 * Notes de **qualité** exigées pour la maîtrise d'une carte et la validation
 * d'une journée de série (L2, L14).
 *
 * Plus strict que `CORRECT_GRADES` : réussir « de justesse » entretient la carte
 * mais ne prouve pas la maîtrise. `MasteryCriteria.minConsecutiveSuccesses`
 * porte sur les notes comptées par l'ordonnanceur (voir `CardState`), tandis que
 * la maîtrise exige au moins `minReps` révisions parmi ces notes de qualité.
 */
export const MASTERY_QUALITY_GRADES = ['good', 'easy'] as const satisfies readonly ReviewGrade[];

/**
 * Fenêtre de la journée où une session a eu lieu (L17).
 *
 * Bornes définies par `SESSION_WINDOW_HOURS` : `morning` [5, 12), `day` [12, 19),
 * `evening` [19, 23), `night` [23, 5). La classification est faite par la couche
 * application à partir de l'heure locale fournie par `ClockPort`.
 */
export const SESSION_WINDOWS = ['morning', 'day', 'evening', 'night'] as const;

/** Fenêtre de journée (union fermée). */
export type SessionWindow = (typeof SESSION_WINDOWS)[number];

/** Nom d'un champ numérique borné du domaine. */
export type BoundedFieldName =
  | 'questionId'
  | 'actId'
  | 'positionInAct'
  | 'confidence'
  | 'difficulty'
  | 'learningStep'
  | 'ratio'
  | 'percentage'
  | 'intervalDays'
  | 'stabilityDays'
  | 'elapsedDays'
  | 'durationMs';

/**
 * Bornes d'exécution des champs numériques, `inclusiveMin ≤ v ≤ inclusiveMax`.
 *
 * Contrat de validation : tout décodage d'une donnée non fiable (stockage,
 * import, saisie) rejette la valeur hors bornes. `null` = pas de borne.
 * Ces bornes sont la contrepartie exécutable de `ADR 0009`.
 */
export const NUMERIC_BOUNDS = {
  questionId: { inclusiveMin: FIRST_QUESTION_ID, inclusiveMax: LAST_QUESTION_ID },
  actId: { inclusiveMin: 1, inclusiveMax: ACT_COUNT },
  positionInAct: { inclusiveMin: 1, inclusiveMax: QUESTIONS_PER_ACT },
  confidence: { inclusiveMin: 1, inclusiveMax: 5 },
  difficulty: { inclusiveMin: 1, inclusiveMax: 10 },
  learningStep: { inclusiveMin: 0, inclusiveMax: 32 },
  ratio: { inclusiveMin: 0, inclusiveMax: 1 },
  percentage: { inclusiveMin: 0, inclusiveMax: 100 },
  intervalDays: { inclusiveMin: 0, inclusiveMax: null },
  stabilityDays: { inclusiveMin: 0, inclusiveMax: null },
  elapsedDays: { inclusiveMin: 0, inclusiveMax: null },
  durationMs: { inclusiveMin: 0, inclusiveMax: null },
} as const satisfies Readonly<
  Record<BoundedFieldName, { readonly inclusiveMin: number; readonly inclusiveMax: number | null }>
>;
