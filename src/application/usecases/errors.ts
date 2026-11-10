import type { SessionBuildFailure } from '@/domain/session/types';
import type { SessionSubmitFailure, SessionTransitionFailure } from '@/domain/session/types';
import type { HookError } from '@/domain/memory/hooks';
import type { ProgressError } from '@/domain/progress/types';

/**
 * Rejets explicites des cas d'usage.
 *
 * Les types d'entrée/sortie des 8 cas d'usage sont **gelés** (contrat
 * `UseCases`) et ne comportent pas de variante d'erreur pour les rejets de
 * contrat : une soumission hors phase, une session inconnue ou une accroche
 * invalide sont des **bugs de l'appelant** (l'UI doit empêcher ces chemins),
 * pas des résultats métier. Ils sont donc signalés par une erreur **typée**
 * portant une raison discriminée, jamais par une `Error` générique.
 *
 * Cette convention ne concerne que le contrôle de processus : les échecs
 * d'I/O (stockage, décodage) ne lèvent **jamais** — ils restent des résultats
 * explicites (`ProgressLoadResult`, `ProgressImportResult`, `StorageResult`)
 * ou, pour `importProgress`/`exportProgress`, des sorties directement unions.
 */
export type UseCaseRejectionReason =
  | 'unknown-session'
  | 'session-transition-refused'
  | 'session-submission-refused'
  | 'session-build-refused'
  | 'hook-refused'
  | 'progress-unavailable'
  /** `future-version` : aucune écriture ni réinitialisation autorisée (Phase 1). */
  | 'progress-protected';

/** Détail discriminé du rejet, selon sa raison. */
export type UseCaseRejectionDetail =
  | { readonly kind: 'none' }
  | { readonly kind: 'session-id'; readonly sessionId: string }
  | { readonly kind: 'build'; readonly failure: SessionBuildFailure }
  | { readonly kind: 'transition'; readonly failure: SessionTransitionFailure }
  | { readonly kind: 'submission'; readonly failure: SessionSubmitFailure }
  | { readonly kind: 'hook'; readonly error: HookError }
  | { readonly kind: 'progress'; readonly error: ProgressError };

/** Rejet typé d'un cas d'usage (voir la note d'ensemble ci-dessus). */
export class UseCaseRejection extends Error {
  readonly reason: UseCaseRejectionReason;
  readonly detail: UseCaseRejectionDetail;

  constructor(reason: UseCaseRejectionReason, detail: UseCaseRejectionDetail, message: string) {
    super(message);
    this.name = 'UseCaseRejection';
    this.reason = reason;
    this.detail = detail;
  }
}
