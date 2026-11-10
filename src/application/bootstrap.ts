import { createEmptyHookLibrary } from '@/domain/memory/hooks';
import { DEFAULT_MASTERY_CRITERIA } from '@/domain/mastery/types';
import type { MasteryCriteria } from '@/domain/mastery/types';
import { SCHEMA_VERSION } from '@/domain/progress/types';
import type { ProgressError, ProgressLoadResult, PersistedProgress } from '@/domain/progress/types';
import { QUESTION_CATALOG } from '@/domain/questions';
import { FIRST_QUESTION_ID, LAST_QUESTION_ID } from '@/domain/shared/types';
import type { LocaleCode } from '@/domain/shared/types';
import { createPrng } from '@/domain/session';
import { DEFAULT_SCHEDULER_CONFIG, createScheduler } from '@/domain/srs';
import type { CardState, SchedulerConfig } from '@/domain/srs/types';

import { createInitialAppState } from '@/application/store';
import type { AppState } from '@/application/store';

import { readPersistedProgress, writeProgress } from './usecases/progress-loader';
import { progressCodec } from '@/application/progress';
import type { ProgressCodecFactory } from '@/application/progress';
import type { AppServices } from './usecases/types';

export type { ProgressCodecFactory } from '@/application/progress';

/**
 * Amorçage applicatif (Phase 3-C).
 *
 * Cette fabrique est le **point de composition de la couche application** :
 * elle câble les implémentations pures du domaine (catalogue, ordonnanceur,
 * critères de maîtrise) et laisse l'appelant injecter les ports réels (les
 * adaptateurs `infrastructure/**` arrivent dans un lot dédié — ici, seuls les
 * contrats sont consommés).
 *
 * Aucune horloge implicite : `createInitialProgress` et `hydrate` datent tout
 * via `services.clock` et identifient tout via `services.ids`. Aucun `Date`,
 * aucun `Math.random`, aucun `localStorage`.
 */

/** Version de l'application écrite dans les métadonnées de progression. */
export const APP_VERSION = '0.1.0';

/** Ports que l'appelant **doit** fournir (aucun défaut possible sans I/O). */
export type InjectedAppPorts = Pick<AppServices, 'storage' | 'clock' | 'speech' | 'ids'> & {
  /**
   * Fabrique de graines opaques : `crypto.randomUUID` en production, compteur
   * en test. Seule cette fabrique a droit à l'aléa non déterministe.
   */
  readonly newSeed: AppServices['newSeed'];
};

/** Réglages optionnels du câblage des implémentations du domaine. */
export interface CreateAppServicesConfig {
  readonly schedulerConfig?: SchedulerConfig;
  readonly masteryCriteria?: MasteryCriteria;
}

/**
 * Fabrique de `AppServices` : câble le catalogue des 36 questions, un
 * ordonnanceur lié à sa configuration et les critères de maîtrise, puis
 * applique les surcharges de l'appelant (adaptateurs réels, tests).
 */
export function createAppServices(
  overrides: Partial<AppServices> & InjectedAppPorts,
  config: CreateAppServicesConfig = {},
): AppServices {
  const schedulerConfig = config.schedulerConfig ?? DEFAULT_SCHEDULER_CONFIG;
  return {
    ...overrides,
    catalog: overrides.catalog ?? QUESTION_CATALOG,
    scheduler: overrides.scheduler ?? createScheduler(schedulerConfig),
    schedulerConfig: overrides.schedulerConfig ?? schedulerConfig,
    masteryCriteria: overrides.masteryCriteria ?? DEFAULT_MASTERY_CRITERIA,
    createRandom: overrides.createRandom ?? ((seed) => createPrng(seed)),
  };
}

/**
 * Progression d'un premier lancement : les 36 cartes en état initial,
 * `PlayerState` neuf (identifiant de profil issu de `IdPort.newProfileId()`),
 * `schemaVersion` courant. Toute valeur vient des services injectés.
 */
export function createInitialProgress(
  services: AppServices,
  locale: LocaleCode = 'fr',
): PersistedProgress {
  const now = services.clock.now();
  const cards: Record<string, CardState> = {};
  for (let questionId = FIRST_QUESTION_ID; questionId <= LAST_QUESTION_ID; questionId += 1) {
    cards[String(questionId)] = services.scheduler.initialState(questionId, now);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    savedAt: now,
    player: {
      profile: {
        id: services.ids.newProfileId(),
        displayName: '',
        createdAt: now,
      },
      totalXp: 0,
      streak: { current: 0, longest: 0, lastActiveDay: null, freezes: 0, frozenDays: [] },
      badges: [],
      questBoard: null,
      collection: { entries: [] },
      settings: {
        locale,
        speechEnabled: true,
        reducedMotion: 'system',
        dailyGoalMinutes: 15,
        confidencePromptEnabled: true,
      },
    },
    cards,
    hooks: createEmptyHookLibrary(now),
    reviewLogs: [],
    sessionLogs: [],
  };
}

/** Résultat d'amorçage : état applicatif complet + statut de chargement. */
export interface HydrateResult {
  readonly state: AppState;
  readonly status: ProgressLoadResult['status'];
  /**
   * Clé de sauvegarde brute créée si la donnée lue était corrompue, sinon
   * `null`. L'écran de récupération (§ 5.2) peut proposer de télécharger ce
   * contenu avant toute réinitialisation.
   */
  readonly backupKey: string | null;
}

/**
 * Lit la progression et construit l'état applicatif initial.
 *
 * - `empty` : crée un profil neuf (`createInitialProgress`) et le persiste —
 *   le stockage était vide, rien ne peut être détruit ;
 * - `loaded` : l'état persisté devient l'état de l'application ;
 * - `future-version` ou `corrupt` : **ne détruit rien** — aucun `write`, aucun
 *   `remove`, aucune migration silencieuse. L'état renvoyé est vide (profil
 *   neuf **en mémoire uniquement**, non persisté) et porte l'erreur dans
 *   `lastError` pour l'écran de récupération.
 */
export function hydrate(
  services: AppServices,
  createCodec: ProgressCodecFactory = () => progressCodec,
  locale: LocaleCode = 'fr',
): HydrateResult {
  const codec = createCodec();
  const read = readPersistedProgress(services, codec);
  const backupKey = read.result.status === 'corrupt' ? read.result.backupKey : null;
  switch (read.result.status) {
    case 'loaded':
      return { state: createInitialAppState(read.result.progress), status: 'loaded', backupKey };
    case 'empty': {
      const fresh = createInitialProgress(services, locale);
      const writeError = writeProgress(services, codec, fresh);
      return {
        state: writeError === null ? createInitialAppState(fresh) : withError(fresh, writeError),
        status: 'empty',
        backupKey,
      };
    }
    case 'future-version':
    case 'corrupt': {
      // Lecture seule : la donnée reste intacte dans le stockage.
      const fresh = createInitialProgress(services, locale);
      return { state: withError(fresh, read.result.error), status: read.result.status, backupKey };
    }
  }
}

/** État applicatif initial portant une erreur de persistance non bloquante. */
function withError(progress: PersistedProgress, error: ProgressError): AppState {
  return { ...createInitialAppState(progress), lastError: error };
}
