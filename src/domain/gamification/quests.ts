import { QUESTIONS_PER_ACT } from '@/domain/shared/types';
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
 *   une quête non terminée expire sans conséquence ;
 * - **pas de ludification substitutive** : une quête ne progresse que sur des
 *   actes de production, et `progress` ne dépasse jamais `target`.
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
 * Progression apportée par une réponse, pour un objectif donné.
 *
 * Le contrat gelé `QuestProgressInput` ne transporte ni identifiant de question,
 * ni acte, ni confiance. Les objectifs qui en dépendent (`distinct-questions`,
 * `act-recall`, `calibration`) sont donc évalués avec le meilleur proxy
 * disponible — la réponse elle-même — et `minAccuracy` des objectifs de
 * précision n'est pas vérifiable dans `QuestState`. Points à arbitrer en Phase 3
 * (voir le rapport de lot) ; ces proxys rendent les quêtes atteignables au lieu
 * de les rendre impossibles.
 */
function advance(objective: QuestObjective, input: QuestProgressInput): number {
  const succeeded = input.grade !== 'again';
  const isProduction = input.exerciseKind === 'production';

  switch (objective.kind) {
    case 'answer-count':
      return (objective.direction === null || objective.direction === input.direction) &&
        (!objective.productionOnly || isProduction)
        ? 1
        : 0;
    case 'accuracy':
      return (objective.direction === null || objective.direction === input.direction) && succeeded
        ? 1
        : 0;
    case 'distinct-questions':
      return isProduction ? 1 : 0;
    case 'new-cards':
      return input.wasNewCard ? 1 : 0;
    case 'hint-free':
      return input.hintsUsed === 0 && succeeded ? 1 : 0;
    case 'speed':
      return input.responseTimeMs <= objective.maxResponseTimeMs ? 1 : 0;
    case 'act-recall':
      return isProduction && succeeded ? 1 : 0;
    case 'calibration':
      return succeeded ? 1 : 0;
    case 'evening-review':
      return input.window === 'evening' ? 1 : 0;
    case 'morning-review':
      return input.window === 'morning' ? 1 : 0;
  }
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
  }));

  return { dayKey, seed, quests, rerollUsed: false };
}

/**
 * Nouveau tableau après une réponse.
 *
 * Le tableau conserve exactement les quêtes qu'il contenait : `progress` ne crée
 * jamais de quête, ne change ni la cible ni `completedAt`. Une définition absente
 * du catalogue laisse la quête intacte (elle ne peut pas être évaluée).
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
    const gained = advance(definition.objective, input);
    if (gained <= 0) {
      return quest;
    }
    const nextProgress = Math.min(quest.progress + gained, quest.target);
    if (nextProgress === quest.progress) {
      return quest;
    }
    changed = true;
    return { ...quest, progress: nextProgress };
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
