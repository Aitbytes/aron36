import { ACCURACY_CREDIT, QUESTIONS_PER_ACT } from '@/domain/shared/types';
import type { ConfidenceRating, EpochMs, QuestionId, ReviewGrade } from '@/domain/shared/types';
import { createPrng } from './prng';
import type {
  QuestBoard,
  QuestBoardRequest,
  QuestDefinition,
  QuestGenerator,
  QuestObjective,
  QuestProgressInput,
  QuestState,
} from './types';
import { DAILY_QUEST_COUNT } from './types';

/**
 * Quêtes quotidiennes (L17).
 *
 * Anti-objectifs servis par ce module :
 * - **pas de dark pattern** : le tirage est déterministe (`dayKey` + `seed`),
 *   donc stable après rechargement, sans compte à rebours ni notification ;
 *   une quête non terminée expire sans conséquence (aucun reroll, aucune
 *   relance artificielle) ;
 * - **pas de ludification substitutive** : une quête ne progresse que sur des
 *   actes de production, et `progress` ne dépasse jamais `target` ;
 * - **pas de reconnaissance déguisée en rappel** : un QCM ne fait progresser
 *   aucune quête, parce qu'aucun objectif ne mesure une discrimination.
 */

/** Cible de progression d'un objectif, déduite de sa forme. */
export function questTarget(objective: QuestObjective): number {
  switch (objective.kind) {
    case 'answer-count':
      return objective.min;
    case 'accuracy':
      return objective.minAnswers;
    case 'distinct-questions':
      return objective.min;
    case 'new-cards':
      return objective.min;
    case 'hint-free':
      return objective.min;
    case 'speed':
      return objective.min;
    case 'act-recall':
      return QUESTIONS_PER_ACT;
    case 'calibration':
      return objective.minAnswers;
    case 'evening-review':
      return objective.min;
    case 'morning-review':
      return objective.min;
  }
}

/**
 * Effet d'une réponse sur une quête.
 *
 * Les faits bruts sont volontairement séparés de leur interprétation : `gained`
 * est l'incrément de `progress`, `resets` traduit l'échec d'une série
 * « d'affilée », et `attempts`/`correct`/`seenQuestionId` alimentent l'état
 * nécessaire aux objectifs qui raisonnent sur plusieurs réponses (précision,
 * calibration, couverture).
 */
interface QuestAdvance {
  /** Réponse prise en compte par cette quête. */
  readonly attempted: boolean;
  /** Réponse réussie (`grade !== 'again'`). */
  readonly succeeded: boolean;
  /** La série en cours est rompue : `progress` repart de zéro. */
  readonly resets: boolean;
  /** Incrément de progression. */
  readonly gained: number;
  /** Question à mémoriser dans `seenQuestionIds`, `null` si déjà comptée. */
  readonly seenQuestionId: QuestionId | null;
}

/** Aucun effet : la réponse ne concerne pas cette quête. */
const NO_ADVANCE: QuestAdvance = {
  attempted: false,
  succeeded: false,
  resets: false,
  gained: 0,
  seenQuestionId: null,
};

/** Réponse comptée sans logique de série. */
function counted(succeeded: boolean, gained: number): QuestAdvance {
  return { attempted: true, succeeded, resets: false, gained, seenQuestionId: null };
}

/** Crédit de réussite d'une note, pour la calibration (L12). */
function creditOf(grade: ReviewGrade): number {
  return ACCURACY_CREDIT[grade];
}

/**
 * Écart entre confiance déclarée et réussite réelle, dans [0, 1].
 * `confidence / 5` ramène l'échelle de Likert sur [0, 1].
 */
function calibrationGapOf(confidence: ConfidenceRating, grade: ReviewGrade): number {
  return Math.abs(confidence / 5 - creditOf(grade));
}

/**
 * Effet réel d'une réponse sur un objectif.
 *
 * Aucun proxy : chaque objectif lit le fait dont il dépend — identité de la
 * question (`distinct-questions`, `act-recall`), acte (`act-recall`), confiance
 * (`calibration`), crédit de la note (`accuracy`, `hint-free`).
 *
 * Tous les objectifs autres que `answer-count` exigent une **production** : ce
 * sont les seuls faits qui prouvent une restitution.
 */
function advanceFor(
  objective: QuestObjective,
  quest: QuestState,
  input: QuestProgressInput,
): QuestAdvance {
  const succeeded = input.grade !== 'again';
  const isProduction = input.exerciseKind === 'production';
  const directionMatches = objectiveDirection(objective);
  if (directionMatches !== null && directionMatches !== input.direction) {
    return NO_ADVANCE;
  }

  switch (objective.kind) {
    case 'answer-count':
      if (objective.productionOnly && !isProduction) {
        return NO_ADVANCE;
      }
      return counted(succeeded, 1);
    case 'accuracy': {
      if (!isProduction) {
        return NO_ADVANCE;
      }
      if (creditOf(input.grade) < objective.minAccuracy) {
        // « d'affilée » : une réponse sous le seuil rompt la série au lieu de
        // s'ajouter à un total complaisant.
        return { attempted: true, succeeded, resets: true, gained: 0, seenQuestionId: null };
      }
      return counted(true, 1);
    }
    case 'distinct-questions': {
      if (!isProduction) {
        return NO_ADVANCE;
      }
      const alreadySeen = quest.seenQuestionIds.includes(input.questionId);
      return {
        attempted: true,
        succeeded,
        resets: false,
        gained: alreadySeen ? 0 : 1,
        seenQuestionId: alreadySeen ? null : input.questionId,
      };
    }
    case 'new-cards':
      if (!isProduction) {
        return NO_ADVANCE;
      }
      return counted(succeeded, input.wasNewCard ? 1 : 0);
    case 'hint-free': {
      // Un QCM ou une réponse aidée ne prouve aucune restitution sans filet.
      if (!isProduction || input.hintsUsed > 0) {
        return NO_ADVANCE;
      }
      // Même barre de justesse que la précision : le crédit de la note doit
      // atteindre `minAccuracy` (un `hard` à 0.5 ne suffit pas à 0.9).
      return counted(succeeded, creditOf(input.grade) >= objective.minAccuracy ? 1 : 0);
    }
    case 'speed':
      if (!isProduction) {
        return NO_ADVANCE;
      }
      return counted(succeeded, input.responseTimeMs <= objective.maxResponseTimeMs ? 1 : 0);
    case 'act-recall': {
      // Réciter un acte : production, réussie, dans **cet** acte, et sur une
      // question pas encore comptée (sinon une question répétée suffirait).
      if (!isProduction || !succeeded || input.actId !== objective.actId) {
        return NO_ADVANCE;
      }
      const alreadySeen = quest.seenQuestionIds.includes(input.questionId);
      return {
        attempted: true,
        succeeded: true,
        resets: false,
        gained: alreadySeen ? 0 : 1,
        seenQuestionId: alreadySeen ? null : input.questionId,
      };
    }
    case 'calibration': {
      if (input.confidence === null) {
        return NO_ADVANCE;
      }
      const aligned = calibrationGapOf(input.confidence, input.grade) <= objective.maxGap;
      // `maxGap` est un seuil par réponse : une réponse mal calibrée ne compte
      // pas, elle n'est pas noyée dans une moyenne complaisante.
      return {
        attempted: true,
        succeeded,
        resets: false,
        gained: aligned ? 1 : 0,
        seenQuestionId: null,
      };
    }
    case 'evening-review':
      if (!isProduction) {
        return NO_ADVANCE;
      }
      return counted(succeeded, input.window === 'evening' ? 1 : 0);
    case 'morning-review':
      if (!isProduction) {
        return NO_ADVANCE;
      }
      return counted(succeeded, input.window === 'morning' ? 1 : 0);
  }
}

/** Direction imposée par un objectif, ou `null` si toutes conviennent. */
function objectiveDirection(objective: QuestObjective): QuestProgressInput['direction'] | null {
  if (objective.kind === 'answer-count' || objective.kind === 'accuracy') {
    return objective.direction;
  }
  return null;
}

/**
 * État suivant d'une quête après une réponse.
 *
 * `completedAt` est écrit au **premier** plafonnement puis n'est plus jamais
 * effacé : une quête accomplie le reste, même si une série d'affilée retombe
 * ensuite — aucune punition rétroactive.
 */
function nextQuestState(quest: QuestState, advance: QuestAdvance, now: EpochMs): QuestState {
  const completed = quest.completedAt !== null;
  const progress =
    advance.resets && !completed ? 0 : Math.min(quest.progress + advance.gained, quest.target);
  const attempts = quest.attempts + (advance.attempted ? 1 : 0);
  const correct = quest.correct + (advance.succeeded ? 1 : 0);
  const seenQuestionIds =
    advance.seenQuestionId === null
      ? quest.seenQuestionIds
      : [...quest.seenQuestionIds, advance.seenQuestionId];
  const completedAt = quest.completedAt ?? (progress >= quest.target ? now : null);

  if (
    progress === quest.progress &&
    attempts === quest.attempts &&
    correct === quest.correct &&
    seenQuestionIds === quest.seenQuestionIds &&
    completedAt === quest.completedAt
  ) {
    return quest;
  }

  return { ...quest, progress, attempts, correct, seenQuestionIds, completedAt };
}

/** Dédoublonne des définitions par identifiant, en conservant le premier ordre. */
function uniqueDefinitions(definitions: readonly QuestDefinition[]): QuestDefinition[] {
  const byId = new Map<string, QuestDefinition>();
  for (const definition of definitions) {
    if (!byId.has(definition.id)) {
      byId.set(definition.id, definition);
    }
  }
  return [...byId.values()];
}

/**
 * Tirage déterministe du tableau du jour.
 *
 * Les quêtes déjà proposées récemment (`recentQuestIds`) sont repoussées en fin
 * de tirage sans être interdites : avec un catalogue plus court que le nombre de
 * quêtes fraîches disponibles, le tableau reste toujours complet.
 */
function boardFor(input: QuestBoardRequest): QuestBoard {
  const { dayKey, seed, definitions, recentQuestIds } = input;
  const prng = createPrng(`${seed}|${dayKey}`);
  const recent = new Set(recentQuestIds);
  const pool = uniqueDefinitions(definitions);
  const fresh = pool.filter((definition) => !recent.has(definition.id));
  const stale = pool.filter((definition) => recent.has(definition.id));
  const selected = [...prng.shuffle(fresh), ...prng.shuffle(stale)].slice(0, DAILY_QUEST_COUNT);

  const quests: QuestState[] = selected.map((definition) => ({
    questId: definition.id,
    dayKey,
    progress: 0,
    target: questTarget(definition.objective),
    completedAt: null,
    attempts: 0,
    correct: 0,
    seenQuestionIds: [],
  }));

  return { dayKey, seed, quests };
}

/**
 * Nouveau tableau après une réponse.
 *
 * Le tableau conserve exactement les quêtes qu'il contenait : `progress` ne crée
 * jamais de quête et ne change ni la cible ni `completedAt` d'une quête déjà
 * terminée. Une définition absente du catalogue laisse la quête intacte (elle ne
 * peut pas être évaluée).
 */
function progress(
  board: QuestBoard,
  definitions: readonly QuestDefinition[],
  input: QuestProgressInput,
): QuestBoard {
  const byId = new Map(definitions.map((definition) => [definition.id, definition] as const));
  let changed = false;

  const quests = board.quests.map((quest) => {
    const definition = byId.get(quest.questId);
    if (definition === undefined) {
      return quest;
    }
    const next = nextQuestState(quest, advanceFor(definition.objective, quest, input), input.now);
    if (next === quest) {
      return quest;
    }
    changed = true;
    return next;
  });

  return changed ? { ...board, quests } : board;
}

/**
 * Catalogue de quêtes livré avec le module.
 *
 * Récompenses conformes au contrat : 15, 25 ou 40 XP selon la difficulté.
 * Tous les objectifs du contrat sont représentés, ce qui garantit qu'aucune
 * variante n'est « décorative ».
 */
export const QUEST_DEFINITIONS: readonly QuestDefinition[] = [
  {
    id: 'echauffement',
    title: { fr: 'Échauffement', en: 'Warm-up' },
    description: {
      fr: 'Produire 10 réponses, sans QCM.',
      en: 'Produce 10 answers, without multiple choice.',
    },
    objective: { kind: 'answer-count', min: 10, direction: null, productionOnly: true },
    xpReward: 15,
  },
  {
    id: 'serie-du-jour',
    title: { fr: 'Série du jour', en: 'Daily set' },
    description: { fr: 'Produire 20 réponses.', en: 'Produce 20 answers.' },
    objective: { kind: 'answer-count', min: 20, direction: null, productionOnly: true },
    xpReward: 25,
  },
  {
    id: 'mot-cle',
    title: { fr: 'Mot-clé', en: 'Keyword' },
    description: {
      fr: 'Produire 8 réponses à partir d’un mot-clé.',
      en: 'Produce 8 answers from a keyword.',
    },
    objective: {
      kind: 'answer-count',
      min: 8,
      direction: 'keyword-to-question',
      productionOnly: true,
    },
    xpReward: 15,
  },
  {
    id: 'precision',
    title: { fr: 'Précision', en: 'Accuracy' },
    description: {
      fr: 'Donner 10 réponses justes d’affilée dans la journée.',
      en: 'Give 10 correct answers during the day.',
    },
    objective: { kind: 'accuracy', minAccuracy: 0.8, minAnswers: 10, direction: null },
    xpReward: 25,
  },
  {
    id: 'tour-des-questions',
    title: { fr: 'Tour des questions', en: 'Question tour' },
    description: { fr: 'Couvrir 12 questions distinctes.', en: 'Cover 12 distinct questions.' },
    objective: { kind: 'distinct-questions', min: 12 },
    xpReward: 25,
  },
  {
    id: 'nouvelles-cartes',
    title: { fr: 'Nouvelles cartes', en: 'New cards' },
    description: { fr: 'Aborder 5 questions encore neuves.', en: 'Open 5 brand-new questions.' },
    objective: { kind: 'new-cards', min: 5 },
    xpReward: 25,
  },
  {
    id: 'sans-indice',
    title: { fr: 'Sans indice', en: 'No hints' },
    description: {
      fr: 'Réussir 8 réponses sans aucun indice.',
      en: 'Succeed 8 answers with no hint.',
    },
    objective: { kind: 'hint-free', min: 8, minAccuracy: 0.9 },
    xpReward: 40,
  },
  {
    id: 'reflexes',
    title: { fr: 'Réflexes', en: 'Reflexes' },
    description: { fr: 'Répondre 10 fois en moins de 4 s.', en: 'Answer 10 times under 4 s.' },
    objective: { kind: 'speed', maxResponseTimeMs: 4000, min: 10 },
    xpReward: 25,
  },
  {
    id: 'recitation-acte',
    title: { fr: 'Récitation d’acte', en: 'Act recitation' },
    description: { fr: 'Réciter un acte entier.', en: 'Recite one full act.' },
    objective: { kind: 'act-recall', actId: 1 },
    xpReward: 40,
  },
  {
    id: 'calibration-du-jour',
    title: { fr: 'Calibration', en: 'Calibration' },
    description: {
      fr: 'Aligner confiance et réussite sur 10 réponses.',
      en: 'Align confidence and success on 10 answers.',
    },
    objective: { kind: 'calibration', maxGap: 0.15, minAnswers: 10 },
    xpReward: 40,
  },
  {
    id: 'revision-du-soir',
    title: { fr: 'Révision du soir', en: 'Evening review' },
    description: { fr: 'Produire 5 réponses après 19 h.', en: 'Produce 5 answers after 7 pm.' },
    objective: { kind: 'evening-review', min: 5 },
    xpReward: 15,
  },
  {
    id: 'rappel-du-matin',
    title: { fr: 'Rappel du matin', en: 'Morning recall' },
    description: { fr: 'Produire 5 réponses avant midi.', en: 'Produce 5 answers before noon.' },
    objective: { kind: 'morning-review', min: 5 },
    xpReward: 15,
  },
];

/** Générateur de quêtes pur : tirage déterministe et progression bornée. */
export const questGenerator: QuestGenerator = { boardFor, progress };
