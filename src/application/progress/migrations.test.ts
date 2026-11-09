import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, type PersistedProgress } from '@/domain/progress/types';
// Faux stockage de test : consommé par le barrel d'infrastructure, en test
// uniquement (aucun code de production applicatif ne dépend de l'infrastructure).
import { MemoryStorageAdapter } from '@/infrastructure';
import { progressCodec } from './codec';
import { loadProgress } from './loadProgress';
import {
  LEITNER_BOX_INTERVAL_DAYS,
  MIGRATIONS,
  findMigration,
  migrateLegacyState,
  migrateV0ToV1,
} from './migrations';
import { createFixedClock } from './testClock';
import { storedKeys, storedRaw } from './testStorage';

/**
 * Fixture **figée** du contenu du prototype v0 (`aron36.srs`) : cartes indexées
 * par numéro, boîte de Leitner 1..5 et échéance epoch. Ne jamais modifier :
 * les migrations doivent rester reproductibles sur la vraie donnée historique.
 */
const FIXTURE_V0_SRS =
  '{"cards":{"1":{"box":1,"due":1000},"5":{"box":5,"due":2000},"17":{"box":3,"due":3000},"36":{"box":2,"due":4000}}}';

describe('migration v0 → v1', () => {
  it('convertit les boîtes de Leitner en intervalles et conserve les échéances', () => {
    const migrated = migrateV0ToV1(JSON.parse(FIXTURE_V0_SRS)) as PersistedProgress;
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.cards['1']).toMatchObject({
      questionId: 1,
      phase: 'review',
      dueAt: 1000,
      intervalDays: 1,
    });
    expect(migrated.cards['5']).toMatchObject({
      questionId: 5,
      phase: 'review',
      dueAt: 2000,
      intervalDays: 16,
    });
    expect(migrated.cards['17']).toMatchObject({
      questionId: 17,
      phase: 'review',
      dueAt: 3000,
      intervalDays: 4,
    });
    expect(migrated.cards['36']).toMatchObject({
      questionId: 36,
      phase: 'review',
      dueAt: 4000,
      intervalDays: 2,
    });
    // Le joueur importé est minimal : aucun historique inventé.
    expect(migrated.player.totalXp).toBe(0);
    expect(migrated.player.questBoard).toBeNull();
    expect(migrated.hooks.hooks).toEqual([]);
    expect(migrated.reviewLogs).toEqual([]);
    expect(migrated.sessionLogs).toEqual([]);
    // Les cases du plan 7 jours ne sont pas importées (aucun champ plan).
    expect(Object.keys(migrated)).not.toContain('plan');
  });

  it('produit, via migrateLegacyState, un état accepté tel quel par le codec', () => {
    const migrated = migrateLegacyState(JSON.parse(FIXTURE_V0_SRS));
    expect(migrated.ok).toBe(true);
    if (migrated.ok) {
      const decoded = progressCodec.decode(JSON.stringify(migrated.value));
      expect(decoded.ok).toBe(true);
    }
  });

  it('rejette une boîte hors 1..5 sans rien produire', () => {
    const broken = { cards: { '3': { box: 6, due: 1000 } } };
    const result = migrateLegacyState(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-shape');
    }
  });

  it('rejette une clé non décimale ou hors 1..36', () => {
    expect(migrateLegacyState({ cards: { '07': { box: 1, due: 1000 } } }).ok).toBe(false);
    expect(migrateLegacyState({ cards: { '37': { box: 1, due: 1000 } } }).ok).toBe(false);
    expect(migrateLegacyState({ cards: { zero: { box: 1, due: 1000 } } }).ok).toBe(false);
    expect(migrateLegacyState({ cards: { '2': { box: 1, due: -5 } } }).ok).toBe(false);
    expect(migrateLegacyState({ wrong: true }).ok).toBe(false);
  });

  it('expose une chaîne de migrations continue de 0 à la version courante', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    for (let version = 0; version < SCHEMA_VERSION; version += 1) {
      const migration = findMigration(MIGRATIONS, version);
      expect(migration).not.toBeNull();
      expect(migration?.toVersion).toBe(version + 1);
      expect(migration?.description.length).toBeGreaterThan(0);
    }
    // L'intervalle gelé des boîtes de Leitner ne doit jamais bouger.
    expect(LEITNER_BOX_INTERVAL_DAYS).toEqual([1, 2, 4, 8, 16]);
  });

  it('n’écrit rien lorsque la migration échoue (donnée legacy intacte)', () => {
    const clock = createFixedClock(5_000_000);
    const storage = new MemoryStorageAdapter();
    storage.write('aron36.srs', '{"cards":{"4":{"box":99,"due":123}}}');
    storage.write('aron36.plan', '{"cases":{}}');

    const result = loadProgress({ storage, clock });

    // La clé v0 illisible est ignorée : statut vide, aucune écriture de
    // récupération, aucune donnée effacée ou modifiée.
    expect(result.status).toBe('empty');
    expect(storedKeys(storage)).toEqual(expect.arrayContaining(['aron36.plan', 'aron36.srs']));
    expect(storedRaw(storage, 'aron36.progress')).toBeNull();
    for (const key of storedKeys(storage)) {
      expect(key.startsWith('aron36.progress.corrupt.')).toBe(false);
    }
  });

  it('importe une clé v0 valide avec migratedFrom = 0 et savedAt de l’horloge', () => {
    const clock = createFixedClock(7_777_777);
    const storage = new MemoryStorageAdapter();
    storage.write('aron36.srs', FIXTURE_V0_SRS);
    storage.write('aron36.plan', '{"cases":{"1":true}}');

    const result = loadProgress({ storage, clock });

    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.migratedFrom).toBe(0);
      expect(result.progress.savedAt).toBe(7_777_777);
      expect(result.progress.cards['5']?.intervalDays).toBe(16);
      // Le plan 7 jours n’a pas été importé : aucun effet sur les quêtes.
      expect(result.progress.player.questBoard).toBeNull();
    }
  });
});
