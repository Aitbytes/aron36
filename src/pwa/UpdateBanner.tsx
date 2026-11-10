import { useSyncExternalStore } from 'react';

import { useT } from '@/i18n';
import { Button } from '@/ui/primitives';

import styles from './UpdateBanner.module.css';
import { swUpdate } from './updateSignal';
import type { SwUpdateSignal } from './updateSignal';

export interface UpdateBannerProps {
  /**
   * Signal de mise à jour. Par défaut celui de production (`swUpdate`), branché
   * par `registerServiceWorker` ; les tests en injectent un.
   */
  readonly signal?: SwUpdateSignal | undefined;
}

/**
 * Bannière discrète « Nouvelle version disponible — Recharger ».
 *
 * Contrat volontairement minimal :
 * - **aucun rechargement automatique** : c'est le bouton qui déclenche
 *   `skipWaiting` + rechargement, jamais la simple détection ;
 * - `role="status"` (donc `aria-live="polite"`) : l'apparition est annoncée sans
 *   interrompre la synthèse vocale en cours ;
 * - rien n'est rendu tant qu'aucun worker n'attend : l'état par défaut est
 *   littéralement absent du DOM, donc aucun impact sur les écrans existants.
 */
export function UpdateBanner({ signal }: UpdateBannerProps = {}) {
  const t = useT();
  const active = signal ?? swUpdate;
  const ready = useSyncExternalStore(active.subscribe, active.isUpdateReady, isServerSnapshot);

  if (!ready) {
    return null;
  }

  return (
    <div className={styles.banner} role="status">
      <span>{t('update.available')}</span>
      <Button size="sm" variant="secondary" onClick={active.applyUpdate}>
        {t('update.reload')}
      </Button>
    </div>
  );
}

/** Hors navigateur (rendu serveur hypothétique), aucune mise à jour n'attend. */
function isServerSnapshot(): boolean {
  return false;
}
