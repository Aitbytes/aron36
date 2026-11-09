import { describe, expect, it } from 'vitest';

import type { SessionWindow } from '@/domain/shared/types';
import { QUEST_DEFINITIONS, questGenerator, questTarget } from './quests';
import type { QuestBoard, QuestDefinition, QuestObjective, QuestProgressInput } from './types';
import { DAILY_QUEST_COUNT } from './types';

/**
 * Anti-objectifs servis (docs/ARCHITECTURE.md § 8.7) :
 * - « le tableau du jour est stable pour un même dayKey » : aucun dark pattern,
 *   aucun reroll pour faire revenir le joueur ;
 * - une quête ne progresse que sur des actes de production et ne dépasse jamais
 *   sa cible ;
 * - chaque objectif est évalué sur le fait dont il dépend (question, acte,
 *   confiance), jamais sur un proxy.
 */

const NOW = 1_700_000_000_000;

function progress(overrides: Partial<QuestProgressInput> = {}): QuestProgressInput {
  return {
    questionId: 1,
    actId: 1,
    direction: 'keyword-to-question',
    exerciseKind: 'production',
    grade: 'good',
    confidence: null,
    responseTimeMs: 2000,
    hintsUsed: 0,
    wasNewCard: false,
    window: 'day',
    now: NOW,
    ...overrides,
  };
}

function definition(id: string, objective: QuestObjective): QuestDefinition {
  return {
    id,
    title: { fr: id, en: id },
    description: { fr: id, en: id },
    objective,
    xpReward: 15,
  };
}

function boardFor(
  definitions: readonly QuestDefinition[],
  recentQuestIds: readonly string[] = [],
): QuestBoard {
  return questGenerator.boardFor({
    dayKey: '2024-03-10',
    seed: 'graine-de-test',
    definitions,
    recentQuestIds,
  });
}

describe('quests — tirage quotidien déterministe', () => {
  it('tire exactement 3 quêtes, sans doublon, à l’état initial', () => {
    const board = boardFor(QUEST_DEFINITIONS);
    expect(board.quests).toHaveLength(DAILY_QUEST_COUNT);
    expect(new Set(board.quests.map((quest) => quest.questId)).size).toBe(DAILY_QUEST_COUNT);
    expect(board.dayKey).toBe('2024-03-10');
    expect(board.seed).toBe('graine-de-test');
    expect(
      board.quests.every(
        (quest) =>
          quest.progress === 0 &&
          quest.completedAt === null &&
          quest.attempts === 0 &&
          quest.correct === 0 &&
          quest.seenQuestionIds.length === 0,
      ),
    ).toBe(true);
  });

  it('rend le même tableau après rechargement (même dayKey, même seed)', () => {
    const first = boardFor(QUEST_DEFINITIONS);
    const second = boardFor(QUEST_DEFINITIONS);
    expect(second).toEqual(first);
    expect(second.quests.map((quest) => quest.questId)).toEqual(
      first.quests.map((quest) => quest.questId),
    );
  });

  it('change de tableau quand la graine ou le jour change', () => {
    const base = boardFor(QUEST_DEFINITIONS);
    const otherSeed = questGenerator.boardFor({
      dayKey: '2024-03-10',
      seed: 'autre-graine',
      definitions: QUEST_DEFINITIONS,
      recentQuestIds: [],
    });
    const otherDay = questGenerator.boardFor({
      dayKey: '2024-03-11',
      seed: 'graine-de-test',
      definitions: QUEST_DEFINITIONS,
      recentQuestIds: [],
    });
    const ids = (board: QuestBoard): string[] => board.quests.map((quest) => quest.questId);
    expect(ids(otherSeed)).not.toEqual(ids(base));
    expect(ids(otherDay)).not.toEqual(ids(base));
  });

  it('écarte les quêtes récentes quand le catalogue le permet', () => {
    const definitions = [
      definition('a', { kind: 'answer-count', min: 1, direction: null, productionOnly: true }),
      definition('b', { kind: 'answer-count', min: 2, direction: null, productionOnly: true }),
      definition('c', { kind: 'answer-count', min: 3, direction: null, productionOnly: true }),
      definition('d', { kind: 'answer-count', min: 4, direction: null, productionOnly: true }),
    ];
    const board = boardFor(definitions, ['a', 'b']);
    const ids = board.quests.map((quest) => quest.questId);
    expect(board.quests).toHaveLength(DAILY_QUEST_COUNT);
    expect(ids).toContain('c');
    expect(ids).toContain('d');
    expect(ids.filter((id) => id === 'a' || id === 'b')).toHaveLength(1);
  });

  it('complète le tableau avec des quêtes récentes si le catalogue est trop court', () => {
    const definitions = [
      definition('a', { kind: 'answer-count', min: 1, direction: null, productionOnly: true }),
      definition('b', { kind: 'answer-count', min: 2, direction: null, productionOnly: true }),
      definition('c', { kind: 'answer-count', min: 3, direction: null, productionOnly: true }),
    ];
    const board = boardFor(definitions, ['a', 'b', 'c']);
    expect(board.quests).toHaveLength(DAILY_QUEST_COUNT);
    expect(new Set(board.quests.map((quest) => quest.questId)).size).toBe(DAILY_QUEST_COUNT);
  });

  it('dédoublonne les définitions et gère un catalogue vide', () => {
    const duplicated = [
      definition('a', { kind: 'answer-count', min: 1, direction: null, productionOnly: true }),
      definition('a', { kind: 'answer-count', min: 99, direction: null, productionOnly: true }),
      definition('b', { kind: 'answer-count', min: 2, direction: null, productionOnly: true }),
    ];
    const board = boardFor(duplicated);
    expect(board.quests).toHaveLength(2);
    expect(board.quests.map((quest) => quest.target)).toContain(1);
    expect(boardFor([]).quests).toEqual([]);
  });

  it('déduit la cible de chaque forme d’objectif', () => {
    expect(
      questTarget({ kind: 'answer-count', min: 7, direction: null, productionOnly: true }),
    ).toBe(7);
    expect(
      questTarget({ kind: 'accuracy', minAccuracy: 0.8, minAnswers: 9, direction: null }),
    ).toBe(9);
    expect(questTarget({ kind: 'distinct-questions', min: 5 })).toBe(5);
    expect(questTarget({ kind: 'new-cards', min: 4 })).toBe(4);
    expect(questTarget({ kind: 'hint-free', min: 6, minAccuracy: 0.9 })).toBe(6);
    expect(questTarget({ kind: 'speed', maxResponseTimeMs: 4000, min: 8 })).toBe(8);
    expect(questTarget({ kind: 'act-recall', actId: 2 })).toBe(12);
    expect(questTarget({ kind: 'calibration', maxGap: 0.1, minAnswers: 10 })).toBe(10);
    expect(questTarget({ kind: 'evening-review', min: 3 })).toBe(3);
    expect(questTarget({ kind: 'morning-review', min: 2 })).toBe(2);
  });

  it('livre un catalogue atteignable et cohérent avec le contrat', () => {
    expect(QUEST_DEFINITIONS.length).toBeGreaterThanOrEqual(DAILY_QUEST_COUNT);
    expect(new Set(QUEST_DEFINITIONS.map((quest) => quest.id)).size).toBe(QUEST_DEFINITIONS.length);
    for (const quest of QUEST_DEFINITIONS) {
      expect(questTarget(quest.objective)).toBeGreaterThanOrEqual(1);
      expect([15, 25, 40]).toContain(quest.xpReward);
      expect(quest.title.fr.length).toBeGreaterThan(0);
    }
    const kinds = new Set(QUEST_DEFINITIONS.map((quest) => quest.objective.kind));
    expect(kinds.size).toBe(10);
  });
});

describe('quests — progression', () => {
  const catalogue = [
    definition('compte', { kind: 'answer-count', min: 2, direction: null, productionOnly: true }),
    definition('prec', { kind: 'accuracy', minAccuracy: 0.8, minAnswers: 2, direction: null }),
    definition('prec-mot-cle', {
      kind: 'accuracy',
      minAccuracy: 0.8,
      minAnswers: 2,
      direction: 'keyword-to-question',
    }),
    definition('distinctes', { kind: 'distinct-questions', min: 2 }),
    definition('neuves', { kind: 'new-cards', min: 2 }),
    definition('sans-indice', { kind: 'hint-free', min: 2, minAccuracy: 0.9 }),
    definition('vitesse', { kind: 'speed', maxResponseTimeMs: 3000, min: 2 }),
    definition('acte', { kind: 'act-recall', actId: 1 }),
    definition('calibration', { kind: 'calibration', maxGap: 0.1, minAnswers: 2 }),
    definition('soir', { kind: 'evening-review', min: 2 }),
    definition('matin', { kind: 'morning-review', min: 2 }),
    definition('mot-cle', {
      kind: 'answer-count',
      min: 2,
      direction: 'keyword-to-question',
      productionOnly: true,
    }),
  ];

  function fullBoard(): QuestBoard {
    // Tableau de test contenant **toutes** les quêtes du catalogue : `boardFor`
    // n'en tire que 3, ce qui rendrait les assertions ambiguës.
    return {
      dayKey: '2024-03-10',
      seed: 'graine-de-test',
      quests: catalogue.map((quest) => ({
        questId: quest.id,
        dayKey: '2024-03-10',
        progress: 0,
        target: questTarget(quest.objective),
        completedAt: null,
        attempts: 0,
        correct: 0,
        seenQuestionIds: [],
      })),
    };
  }

  function progressQuest(board: QuestBoard, questId: string, input: QuestProgressInput): number {
    // On ne progresse qu’une quête à la fois : les autres restent à 0.
    const single: QuestDefinition[] = catalogue.filter((quest) => quest.id === questId);
    const updated = questGenerator.progress(board, single, input);
    return updated.quests.find((quest) => quest.questId === questId)?.progress ?? -1;
  }

  function stateOf(board: QuestBoard, questId: string): QuestBoard['quests'][number] | undefined {
    return board.quests.find((quest) => quest.questId === questId);
  }

  it('progresse un objectif de comptage, filtré par direction et production', () => {
    const board = fullBoard();
    expect(progressQuest(board, 'compte', progress())).toBe(1);
    expect(progressQuest(board, 'compte', progress({ exerciseKind: 'discrimination' }))).toBe(0);
    expect(progressQuest(board, 'mot-cle', progress({ direction: 'image-to-question' }))).toBe(0);
  });

  it('progresse une précision uniquement sur une réponse réussie', () => {
    const board = fullBoard();
    expect(progressQuest(board, 'prec', progress())).toBe(1);
    expect(progressQuest(board, 'prec', progress({ grade: 'again' }))).toBe(0);
    expect(progressQuest(board, 'prec-mot-cle', progress())).toBe(1);
    expect(progressQuest(board, 'prec-mot-cle', progress({ direction: 'image-to-question' }))).toBe(
      0,
    );
  });

  it('rompt la série d’affilée au lieu de cumuler malgré une erreur', () => {
    // Ancien proxy : toute réponse réussie s’additionnait, même après une erreur.
    const board = fullBoard();
    const single = catalogue.filter((quest) => quest.id === 'prec');
    const succeeded = questGenerator.progress(board, single, progress());
    expect(stateOf(succeeded, 'prec')?.progress).toBe(1);

    const failed = questGenerator.progress(succeeded, single, progress({ grade: 'again' }));
    expect(stateOf(failed, 'prec')?.progress).toBe(0);
    expect(stateOf(succeeded, 'prec')?.progress).toBe(1);
  });

  it('honore minAccuracy d’un objectif de précision', () => {
    const strict = [
      definition('strict', { kind: 'accuracy', minAccuracy: 0.9, minAnswers: 3, direction: null }),
    ];
    const board = boardFor(strict);
    // Ancien proxy : les trois réponses « réussies » auraient suffi à clôturer.
    const scenario = [
      progress({ grade: 'good' }), // crédit 1 ≥ 0.9 → 1
      progress({ grade: 'good' }), // crédit 1 ≥ 0.9 → 2
      progress({ grade: 'hard' }), // crédit 0.5 < 0.9 : sous le seuil, série rompue
    ];
    let current = board;
    for (const input of scenario) {
      current = questGenerator.progress(current, strict, input);
    }
    const quest = stateOf(current, 'strict');
    expect(quest?.attempts).toBe(3);
    expect(quest?.correct).toBe(3);
    expect(quest?.progress).toBe(0);
    expect(quest?.completedAt).toBeNull();
  });

  it('progresse les objectifs de nouveauté, d’indice et de rapidité', () => {
    const board = fullBoard();
    expect(progressQuest(board, 'neuves', progress({ wasNewCard: true }))).toBe(1);
    expect(progressQuest(board, 'neuves', progress({ wasNewCard: false }))).toBe(0);
    expect(progressQuest(board, 'sans-indice', progress({ hintsUsed: 0 }))).toBe(1);
    // `hard` est une réussite mais son crédit (0.5) est sous `minAccuracy` 0.9.
    expect(progressQuest(board, 'sans-indice', progress({ grade: 'hard' }))).toBe(0);
    expect(progressQuest(board, 'sans-indice', progress({ hintsUsed: 2 }))).toBe(0);
    expect(progressQuest(board, 'vitesse', progress({ responseTimeMs: 3000 }))).toBe(1);
    expect(progressQuest(board, 'vitesse', progress({ responseTimeMs: 3001 }))).toBe(0);
  });

  it('ne compte les questions distinctes qu’une seule fois', () => {
    // Ancien proxy : chaque production comptait, même la même question répétée.
    const board = fullBoard();
    const single = catalogue.filter((quest) => quest.id === 'distinctes');
    let current = board;
    for (let index = 0; index < 5; index += 1) {
      current = questGenerator.progress(current, single, progress({ questionId: 7 }));
    }
    expect(stateOf(current, 'distinctes')?.progress).toBe(1);
    expect(stateOf(current, 'distinctes')?.seenQuestionIds).toEqual([7]);

    // Une deuxième question distincte fait bien avancer la quête.
    const second = questGenerator.progress(current, single, progress({ questionId: 8 }));
    expect(stateOf(second, 'distinctes')?.progress).toBe(2);
    expect(stateOf(second, 'distinctes')?.completedAt).toBe(NOW);

    // Un QCM ne couvre aucune question.
    expect(progressQuest(board, 'distinctes', progress({ exerciseKind: 'discrimination' }))).toBe(
      0,
    );
  });

  it('n’avance l’acte visé que sur des productions de cet acte', () => {
    // Ancien proxy : l’acte n’était jamais lu, toute réussite comptait.
    const board = fullBoard();
    expect(progressQuest(board, 'acte', progress({ actId: 1 }))).toBe(1);
    expect(progressQuest(board, 'acte', progress({ actId: 2 }))).toBe(0);
    expect(progressQuest(board, 'acte', progress({ actId: 3 }))).toBe(0);
    expect(progressQuest(board, 'acte', progress({ grade: 'again' }))).toBe(0);
    expect(progressQuest(board, 'acte', progress({ exerciseKind: 'discrimination' }))).toBe(0);
  });

  it('exige des questions distinctes pour réciter un acte entier', () => {
    const board = fullBoard();
    const single = catalogue.filter((quest) => quest.id === 'acte');
    let current = board;
    for (let index = 0; index < 3; index += 1) {
      current = questGenerator.progress(current, single, progress({ questionId: 1, actId: 1 }));
    }
    expect(stateOf(current, 'acte')?.progress).toBe(1);
    expect(stateOf(current, 'acte')?.target).toBe(12);
  });

  it('n’avance la calibration que sur un écart confiance/réussite réel', () => {
    // Ancien proxy : toute réponse réussie comptait, quel que soit `maxGap`.
    const board = fullBoard();
    // Confiance 1 sur une réussite facile : écart 0.8 > 0.1 → aucun progrès.
    expect(progressQuest(board, 'calibration', progress({ confidence: 1, grade: 'easy' }))).toBe(0);
    // Confiance 5 sur un échec : écart 1 → aucun progrès.
    expect(progressQuest(board, 'calibration', progress({ confidence: 5, grade: 'again' }))).toBe(
      0,
    );
    // Sans jugement de confiance : la quête ne progresse pas du tout.
    const withoutConfidence = progressQuest(board, 'calibration', progress({ confidence: null }));
    expect(withoutConfidence).toBe(0);
    // Confiance alignée : progrès.
    expect(progressQuest(board, 'calibration', progress({ confidence: 5, grade: 'easy' }))).toBe(1);
    // Écart exactement égal à `maxGap` : accepté (borne inclusive).
    expect(progressQuest(board, 'calibration', progress({ confidence: 3, grade: 'hard' }))).toBe(1);
    // Écart juste au-dessus du seuil : refusé.
    expect(progressQuest(board, 'calibration', progress({ confidence: 4, grade: 'hard' }))).toBe(0);
  });

  it('distingue les quêtes du soir et du matin (L17)', () => {
    const board = fullBoard();
    const windows: SessionWindow[] = ['morning', 'day', 'evening', 'night'];
    const evening = windows.map((window) => progressQuest(board, 'soir', progress({ window })));
    const morning = windows.map((window) => progressQuest(board, 'matin', progress({ window })));
    expect(evening).toEqual([0, 0, 1, 0]);
    expect(morning).toEqual([1, 0, 0, 0]);
  });

  it('plafonne la progression à la cible et date le premier plafonnement', () => {
    let board = fullBoard();
    const single = catalogue.filter((quest) => quest.id === 'compte');
    board = questGenerator.progress(board, single, progress({ now: 10 }));
    expect(stateOf(board, 'compte')?.completedAt).toBeNull();
    board = questGenerator.progress(board, single, progress({ now: 20 }));
    expect(stateOf(board, 'compte')?.progress).toBe(2);
    expect(stateOf(board, 'compte')?.completedAt).toBe(20);

    // Une réponse ultérieure n’écrase pas la date de première obtention.
    board = questGenerator.progress(board, single, progress({ now: 30 }));
    expect(stateOf(board, 'compte')?.completedAt).toBe(20);
  });

  it('garde une quête accomplie à sa cible, même si la série retombe', () => {
    let board = fullBoard();
    const single = catalogue.filter((quest) => quest.id === 'prec');
    board = questGenerator.progress(board, single, progress({ now: 10 }));
    board = questGenerator.progress(board, single, progress({ now: 20 }));
    expect(stateOf(board, 'prec')?.completedAt).toBe(20);

    board = questGenerator.progress(board, single, progress({ grade: 'again', now: 30 }));
    expect(stateOf(board, 'prec')?.progress).toBe(2);
    expect(stateOf(board, 'prec')?.completedAt).toBe(20);
  });

  it('ne crée jamais de quête et ne touche pas aux quêtes inconnues', () => {
    const board = fullBoard();
    const single = catalogue.filter((quest) => quest.id === 'inconnue');
    const updated = questGenerator.progress(board, single, progress());
    expect(updated).toBe(board);
    expect(updated.quests).toHaveLength(board.quests.length);
  });

  it('renvoie le même tableau quand rien ne progresse', () => {
    const board = fullBoard();
    const updated = questGenerator.progress(
      board,
      catalogue,
      progress({
        exerciseKind: 'discrimination',
        grade: 'again',
        confidence: null,
        hintsUsed: 3,
        responseTimeMs: 99_999,
        wasNewCard: false,
      }),
    );
    expect(updated).toBe(board);
  });

  it('avance toutes les quêtes concernées sans en ajouter', () => {
    const board = fullBoard();
    const updated = questGenerator.progress(board, catalogue, progress());
    expect(updated.quests).toHaveLength(board.quests.length);
    expect(updated.quests.map((quest) => quest.questId)).toEqual(
      board.quests.map((quest) => quest.questId),
    );
    expect(updated.quests.every((quest) => quest.progress <= quest.target)).toBe(true);
  });
});
