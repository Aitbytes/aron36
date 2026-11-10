import { useCallback, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import { PROGRESS_RECOVERY_ACTIONS } from '@/domain/progress/types';
import type { PersistedProgress, ProgressError, ProgressErrorCode } from '@/domain/progress/types';
import { useT } from '@/i18n';
import type { MessageKey } from '@/i18n';
import { Button, Dialog, Panel } from '@/ui/primitives';
import { useActions, useAsyncAction } from '@/ui/store';
import type { ActionResult } from '@/ui/store';

import styles from './Screens.module.css';

/** Message par code d'erreur de persistance (taxonomie gelée du domaine). */
const RECOVERY_MESSAGE_KEYS = {
  'invalid-json': 'recovery.code.invalidJson',
  'invalid-shape': 'recovery.code.invalidShape',
  'unsupported-version': 'recovery.code.unsupportedVersion',
  'missing-migration': 'recovery.code.missingMigration',
  'future-version': 'recovery.code.futureVersion',
  'read-failed': 'recovery.code.readFailed',
  'write-failed': 'recovery.code.writeFailed',
  'quota-exceeded': 'recovery.code.quotaExceeded',
  'storage-unavailable': 'recovery.code.storageUnavailable',
} as const satisfies Readonly<Record<ProgressErrorCode, MessageKey>>;

export interface RecoveryBannerProps {
  readonly error: ProgressError;
}

/**
 * Bandeau de récupération de données.
 *
 * Rien n'est écrasé silencieusement : l'action proposée dépend de la **table de
 * décision du domaine** (`PROGRESS_RECOVERY_ACTIONS`). Une donnée provenant d'une
 * version future n'offre ni import ni réinitialisation (elle serait détruite).
 * La réinitialisation exige **deux** confirmations.
 */
export function RecoveryBanner({ error }: RecoveryBannerProps) {
  const t = useT();
  const actions = useActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0);

  const [importError, setImportError] = useState(false);

  const importOperation = useCallback(
    async (file: File): Promise<ActionResult<PersistedProgress>> => {
      try {
        const raw = await readFileAsText(file);
        setImportError(false);
        return actions.importProgress({ raw });
      } catch (error) {
        // Une lecture de fichier peut échouer (fichier disparu, permission) :
        // l'échec est affiché, jamais avalé ni transformé en exception non gérée.
        console.error('Lecture du fichier de sauvegarde impossible :', error);
        setImportError(true);
        return { ok: false, reason: 'importFailed', error: null };
      }
    },
    [actions],
  );
  const { pending: importing, run: runImport } = useAsyncAction(importOperation);

  const resetOperation = useCallback(() => actions.resetProgress(), [actions]);
  const { pending: resetting, run: runReset } = useAsyncAction(resetOperation);

  const action = PROGRESS_RECOVERY_ACTIONS[error.code];
  const canRescue = action === 'offer-import-or-reset';

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0] ?? null;
    // Le champ est réutilisable : le même fichier doit pouvoir être rejoué.
    event.target.value = '';
    if (file === null) {
      return;
    }
    void runImport(file);
  };

  const handleResetConfirm = (): void => {
    setConfirmStep(0);
    void runReset();
  };

  return (
    <Panel title={t('recovery.title')} className={styles.recovery}>
      {action === 'offer-import-or-reset' ? <p>{t('recovery.rescue')}</p> : null}
      {action === 'ask-to-update-app' ? <p>{t('recovery.updateApp')}</p> : null}
      {action === 'retry-later' ? <p>{t('recovery.retryLater')}</p> : null}
      <p className={styles.muted}>{t(RECOVERY_MESSAGE_KEYS[error.code])}</p>
      <p className={styles.muted}>{t('recovery.protected')}</p>
      <p className={styles.muted}>{t('recovery.details', { code: error.code })}</p>
      {importError ? (
        <p role="alert" className={styles.error}>
          {t('action.failure.importFailed')}
        </p>
      ) : null}

      {canRescue ? (
        <div className={styles.recoveryActions}>
          <input
            ref={inputRef}
            className={styles.fileInput}
            type="file"
            accept="application/json,.json"
            tabIndex={-1}
            onChange={handleFileChange}
          />
          <Button loading={importing} onClick={() => inputRef.current?.click()}>
            {t('recovery.import')}
          </Button>
          <Button variant="danger" loading={resetting} onClick={() => setConfirmStep(1)}>
            {t('recovery.reset')}
          </Button>
        </div>
      ) : null}

      <Dialog
        open={confirmStep > 0}
        onClose={() => setConfirmStep(0)}
        title={t('recovery.resetTitle')}
        closeLabel={t('recovery.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmStep(0)}>
              {t('recovery.cancel')}
            </Button>
            {confirmStep === 1 ? (
              <Button variant="danger" onClick={() => setConfirmStep(2)}>
                {t('recovery.resetContinue')}
              </Button>
            ) : (
              <Button variant="danger" loading={resetting} onClick={handleResetConfirm}>
                {t('recovery.resetConfirm')}
              </Button>
            )}
          </>
        }
      >
        <p>{t('recovery.resetBody')}</p>
        {confirmStep === 2 ? <p className={styles.error}>{t('recovery.resetSecondStep')}</p> : null}
      </Dialog>
    </Panel>
  );
}

/** Lit un fichier texte via `FileReader` (présent en jsdom comme en navigateur). */
function readFileAsText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('lecture du fichier impossible'));
    };
    reader.readAsText(file);
  });
}
