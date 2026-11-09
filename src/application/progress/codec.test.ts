import { describe, expect, it } from 'vitest';

import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  MAX_REVIEW_LOG_ENTRIES,
  type PersistedProgress,
} from '@/domain/progress/types';
import type { Migration } from '@/domain/progress/types';
import { createProgressCodec, progressCodec } from './codec';
import { buildFullProgress } from './testState';

/** État valide re-désérialisable, pour les mutations « données corrompues ». */
function encodedFullState(): string {
  return progressCodec.encode(buildFullProgress());
}

function decodeErrorOf(raw: string) {
  const result = progressCodec.decode(raw);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('decode aurait dû échouer');
  }
  return result.error;
}

describe('codec de persistance', () => {
  it('réalise l’aller-retour encode → decode sur un état complet réaliste', () => {
    const state = buildFullProgress();
    const encoded = progressCodec.encode(state);
    const decoded = progressCodec.decode(encoded);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.progress).toEqual(state);
      expect(decoded.migratedFrom).toBeNull();
    }
  });

  it('produit un JSON stable et canoniquement trié', () => {
    const state = buildFullProgress();
    const first = progressCodec.encode(state);
    const second = progressCodec.encode(state);
    expect(first).toBe(second);
    // Ordre lexicographique des clés de la racine : la forme compacte native
    // (JSON.stringify(JSON.parse)) ne peut pas reproduire ce tri.
    expect(first.indexOf('"appVersion"')).toBeLessThan(first.indexOf('"cards"'));
    expect(first.indexOf('"cards"')).toBeLessThan(first.indexOf('"hooks"'));
    expect(first.indexOf('"hooks"')).toBeLessThan(first.indexOf('"player"'));
    expect(first.indexOf('"player"')).toBeLessThan(first.indexOf('"reviewLogs"'));
    expect(first.indexOf('"savedAt"')).toBeLessThan(first.indexOf('"schemaVersion"'));
    // Les clés entières de `cards` (« 1 »..« 36 ») sont sérialisées en ordre
    // numérique croissant : c'est l'ordre garanti par le moteur JavaScript
    // pour les clés d'indice, donc stable entre navigateurs et versions.
    expect(first.indexOf('"2":{')).toBeGreaterThan(-1);
    expect(first.indexOf('"2":{')).toBeLessThan(first.indexOf('"10":'));
  });

  it('signale un JSON invalide par invalid-json', () => {
    expect(decodeErrorOf('{"schemaVersion": 1,').code).toBe('invalid-json');
    expect(decodeErrorOf('not json at all').code).toBe('invalid-json');
  });

  it('signale une racine non objet par invalid-shape', () => {
    expect(decodeErrorOf('[]').code).toBe('invalid-shape');
    expect(decodeErrorOf('"chaîne"').code).toBe('invalid-shape');
    expect(decodeErrorOf('null').code).toBe('invalid-shape');
  });

  it('traite une version future comme lecture seule et sans migration', () => {
    const tampered = encodedFullState().replace('"schemaVersion":1', '"schemaVersion":2');
    expect(tampered).not.toBe(encodedFullState());
    const error = decodeErrorOf(tampered);
    expect(error.code).toBe('future-version');
    expect(error.details?.version).toBe('2');
  });

  it('traite une version antérieure au support par unsupported-version', () => {
    const error = decodeErrorOf('{"schemaVersion":0,"appVersion":"x"}');
    expect(error.code).toBe('unsupported-version');
    expect(error.details?.version).toBe('0');
  });

  it('signale un trou dans la chaîne de migrations', () => {
    const stepOneToTwo: Migration = {
      fromVersion: 1,
      toVersion: 2,
      description: 'test',
      migrate: (input) => input,
    };
    const gapped = createProgressCodec({ migrations: [stepOneToTwo], schemaVersion: 3 });
    const result = gapped.decode(encodedFullState());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('missing-migration');
      expect(result.error.details?.version).toBe('2');
    }
  });

  it('applique une chaîne de migrations complète et rapporte la version d’origine', () => {
    const bump = (input: unknown, version: number) => ({
      ...(input as Record<string, unknown>),
      schemaVersion: version,
    });
    const migrations: Migration[] = [
      { fromVersion: 1, toVersion: 2, description: 'test 1→2', migrate: (input) => bump(input, 2) },
      {
        fromVersion: 2,
        toVersion: 3,
        description: 'test 2→3',
        migrate: (input) => ({ ...bump(input, 3), appVersion: 'migré-v3' }),
      },
    ];
    const codec = createProgressCodec({ migrations, schemaVersion: 3 });
    const result = codec.decode(encodedFullState());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedFrom).toBe(1);
      expect(result.progress.appVersion).toBe('migré-v3');
    }
  });

  it('convertit l’échec d’une migration en invalid-shape', () => {
    const exploding: Migration = {
      fromVersion: 1,
      toVersion: 2,
      description: 'test explosif',
      migrate: () => {
        throw new Error('donnée inexploitable');
      },
    };
    const codec = createProgressCodec({ migrations: [exploding], schemaVersion: 2 });
    const result = codec.decode(encodedFullState());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-shape');
      expect(result.error.message).toContain('donnée inexploitable');
    }
  });

  it('rejette une difficulté hors bornes (42) sans la recadrer', () => {
    const raw = encodedFullState().replace('"difficulty":5.5', '"difficulty":42');
    const error = decodeErrorOf(raw);
    expect(error.code).toBe('invalid-shape');
    expect(error.details?.field).toContain('difficulty');
  });

  it('rejette un identifiant de question hors bornes (37)', () => {
    const raw = encodedFullState().replace('"questionId":25', '"questionId":37');
    const error = decodeErrorOf(raw);
    expect(error.code).toBe('invalid-shape');
    expect(error.details?.field).toContain('questionId');
  });

  it('rejette un intervalle négatif (-1)', () => {
    const raw = encodedFullState().replace('"intervalDays":22', '"intervalDays":-1');
    const error = decodeErrorOf(raw);
    expect(error.code).toBe('invalid-shape');
    expect(error.details?.field).toContain('intervalDays');
  });

  it('rejette une carte indexée « 07 » (décimale non canonique)', () => {
    const state = buildFullProgress();
    const cards = { ...state.cards } as Record<string, unknown>;
    cards['07'] = cards['7'];
    delete cards['7'];
    const mutated = { ...state, cards } as unknown as PersistedProgress;
    const error = decodeErrorOf(progressCodec.encode(mutated));
    expect(error.code).toBe('invalid-shape');
    expect(error.details?.field).toBe('cards.07');
  });

  it('rejette une divergence entre la clé et questionId', () => {
    const state = buildFullProgress();
    const cards = { ...state.cards } as Record<string, unknown>;
    cards['3'] = { ...cards['3']!, questionId: 4 };
    const mutated = { ...state, cards } as unknown as PersistedProgress;
    const error = decodeErrorOf(progressCodec.encode(mutated));
    expect(error.code).toBe('invalid-shape');
    expect(error.details?.field).toBe('cards.3.questionId');
  });

  it('remet en ordre un journal non trié (choix : tri canonique, pas de rejet)', () => {
    const state = buildFullProgress();
    const shuffledLogs = [...state.reviewLogs].reverse();
    const mutated = { ...state, reviewLogs: shuffledLogs };
    const decoded = progressCodec.decode(progressCodec.encode(mutated));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      const times = decoded.progress.reviewLogs.map((log) => log.reviewedAt);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(decoded.progress.reviewLogs).toEqual(state.reviewLogs);
    }
  });

  it('tronque un journal trop long en gardant les plus récentes', () => {
    const state = buildFullProgress();
    const template = state.reviewLogs[0];
    if (template === undefined) {
      throw new Error('fixture sans journal de révision');
    }
    const total = MAX_REVIEW_LOG_ENTRIES + 3;
    const overflow: typeof state.reviewLogs = Array.from({ length: total }, (_, index) => ({
      ...template,
      id: `r_overflow-${index}`,
      reviewedAt: index * 1000,
    }));
    const decoded = progressCodec.decode(progressCodec.encode({ ...state, reviewLogs: overflow }));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.progress.reviewLogs).toHaveLength(MAX_REVIEW_LOG_ENTRIES);
      // Les trois plus anciennes (index 0, 1, 2) sont tombées ; la première
      // conservée est celle d'index 3.
      expect(decoded.progress.reviewLogs[0]?.id).toBe('r_overflow-3');
      expect(decoded.progress.reviewLogs.at(-1)?.id).toBe(`r_overflow-${total - 1}`);
    }
  });

  it('rejette une accroche dupliquée pour la même question', () => {
    const state = buildFullProgress();
    const firstHook = state.hooks.hooks[0];
    if (firstHook === undefined) {
      throw new Error('fixture sans accroche');
    }
    const duplicated = { ...firstHook, kind: 'story' as const };
    const mutated = {
      ...state,
      hooks: { ...state.hooks, hooks: [...state.hooks.hooks, duplicated] },
    };
    const error = decodeErrorOf(progressCodec.encode(mutated));
    expect(error.code).toBe('invalid-shape');
    expect(error.details?.field).toContain('hooks.hooks');
  });

  it('rejette une accroche dont la longueur sort des limites', () => {
    const state = buildFullProgress();
    const firstHook = state.hooks.hooks[0];
    if (firstHook === undefined) {
      throw new Error('fixture sans accroche');
    }
    const tooLong = { ...firstHook, text: 'x'.repeat(281) };
    const mutated = { ...state, hooks: { ...state.hooks, hooks: [tooLong] } };
    expect(decodeErrorOf(progressCodec.encode(mutated)).code).toBe('invalid-shape');
    const empty = { ...firstHook, text: '' };
    const emptied = { ...state, hooks: { ...state.hooks, hooks: [empty] } };
    expect(decodeErrorOf(progressCodec.encode(emptied)).code).toBe('invalid-shape');
  });

  it('rejette une carte « new » qui porterait déjà une révision', () => {
    const state = buildFullProgress();
    const cards = { ...state.cards } as Record<string, unknown>;
    cards['36'] = { ...cards['36']!, reps: 2 };
    const mutated = { ...state, cards } as unknown as PersistedProgress;
    const error = decodeErrorOf(progressCodec.encode(mutated));
    expect(error.code).toBe('invalid-shape');
    expect(error.details?.field).toBe('cards.36');
  });

  it('rejette une série courante supérieure au record', () => {
    const state = buildFullProgress();
    const mutated = {
      ...state,
      player: { ...state.player, streak: { ...state.player.streak, current: 99, longest: 12 } },
    };
    expect(decodeErrorOf(progressCodec.encode(mutated)).code).toBe('invalid-shape');
  });

  it('rejette un tableau de quêtes qui ne porte pas exactement trois quêtes', () => {
    const state = buildFullProgress();
    const mutated = {
      ...state,
      player: {
        ...state.player,
        questBoard: {
          ...state.player.questBoard!,
          quests: state.player.questBoard!.quests.slice(0, 2),
        },
      },
    };
    expect(decodeErrorOf(progressCodec.encode(mutated)).code).toBe('invalid-shape');
  });

  it('isole les deux formats : decode refuse une enveloppe, fromExport refuse un état nu', () => {
    const state = buildFullProgress();
    const envelope = progressCodec.toExport(state, 1_762_700_000_000);
    const envelopeRaw = JSON.stringify(envelope);
    expect(decodeErrorOf(envelopeRaw).code).toBe('invalid-shape');
    const bareImport = progressCodec.fromExport(progressCodec.encode(state));
    expect(bareImport.ok).toBe(false);
    if (!bareImport.ok) {
      expect(bareImport.error.code).toBe('invalid-shape');
    }
  });

  it('réalise l’aller-retour toExport → fromExport', () => {
    const state = buildFullProgress();
    const exportedAt = 1_762_700_000_000;
    const envelope = progressCodec.toExport(state, exportedAt);
    expect(envelope.format).toBe(EXPORT_FORMAT);
    expect(envelope.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(envelope.exportedAt).toBe(new Date(exportedAt).toISOString());
    const imported = progressCodec.fromExport(JSON.stringify(envelope));
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.progress).toEqual(state);
      expect(imported.migratedFrom).toBeNull();
    }
  });

  it('rejette une enveloppe d’export mal formée', () => {
    const state = buildFullProgress();
    const envelope = progressCodec.toExport(state, 1_762_700_000_000);
    expect(
      progressCodec.fromExport(JSON.stringify({ ...envelope, format: 'autre-format' })).ok,
    ).toBe(false);
    expect(progressCodec.fromExport(JSON.stringify({ ...envelope, formatVersion: 99 })).ok).toBe(
      false,
    );
    expect(progressCodec.fromExport(JSON.stringify({ ...envelope, exportedAt: 'hier' })).ok).toBe(
      false,
    );
    const { progress: _omitted, ...withoutProgress } = envelope;
    void _omitted;
    expect(progressCodec.fromExport(JSON.stringify(withoutProgress)).ok).toBe(false);
    expect(progressCodec.fromExport('{"format":').ok).toBe(false);
  });

  it('n’ignore pas silencieusement un schemaVersion final incohérent après migration', () => {
    const lyingMigration: Migration = {
      fromVersion: 1,
      toVersion: 2,
      description: 'oublie de changer la version',
      migrate: (input) => input, // ne passe pas schemaVersion à 2
    };
    const codec = createProgressCodec({ migrations: [lyingMigration], schemaVersion: 2 });
    const result = codec.decode(encodedFullState());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-shape');
      expect(result.error.details?.field).toBe('schemaVersion');
    }
  });
});
