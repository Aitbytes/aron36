/**
 * Persistance applicative : codec, migrations, chargement, sauvegarde.
 *
 * Ce module est la frontière « données non fiables → état du domaine ».
 * Il n'accède jamais au DOM : le stockage et l'horloge arrivent par ports.
 */
export { createProgressCodec, type ProgressCodecOptions } from './codec';
export { progressCodec } from './codec';
export {
  LEITNER_BOX_INTERVAL_DAYS,
  MIGRATIONS,
  findMigration,
  migrateLegacyState,
  migrateV0ToV1,
  type LegacyMigrationResult,
  type LegacyV0Card,
  type LegacyV0State,
} from './migrations';
export { loadProgress, type LoadProgressDeps } from './loadProgress';
export {
  saveProgress,
  storageFailureToError,
  type ProgressSaveResult,
  type SaveProgressDeps,
} from './saveProgress';
