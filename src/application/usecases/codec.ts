import type {
  ExportEnvelope,
  PersistedProgress,
  ProgressDecodeResult,
} from '@/domain/progress/types';
import type { ProgressImportResult } from '@/domain/progress/types';
import type { EpochMs } from '@/domain/shared/types';

/**
 * Forme locale minimale du codec de progression.
 *
 * TODO(progress-lot) : le codec **réel** (`@/application/progress`) est
 * développé dans un lot parallèle et n'existe pas encore dans cette branche.
 * Cette interface est structurellement identique à `ProgressCodec`
 * (`@/domain/progress/types`) : quand le lot livrera son implémentation, elle
 * sera assignable telle quelle à `ProgressCodecFactory` sans changer un seul
 * appelant, et ce fichier disparaîtra au profit d'une importation directe.
 * Aucune logique de codec n'est dupliquée ici — seule la **forme** du contrat
 * est décrite, pour que les cas d'usage puissent être écrits et testés.
 */
export interface ProgressCodecLike {
  /** Sérialise l'état complet en JSON stable. */
  encode(progress: PersistedProgress): string;
  /** Décode, valide et migre une chaîne au format interne uniquement. */
  decode(raw: string): ProgressDecodeResult;
  /** Construit l'enveloppe d'export à partir d'un état valide. */
  toExport(progress: PersistedProgress, now: EpochMs): ExportEnvelope;
  /** Valide une enveloppe d'export et renvoie l'état migré. */
  fromExport(raw: string): ProgressImportResult;
}

/**
 * Fabrique injectable du codec : chaque composition racine (bootstrap,
 * tests, futur `@/application/progress`) fournit la sienne.
 */
export type ProgressCodecFactory = () => ProgressCodecLike;
