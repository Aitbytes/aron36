import { useT } from '@/i18n';
import { Spinner } from '@/ui/primitives';

import styles from './Screens.module.css';

/** Écran de chargement : progression non encore hydratée (`state.ready === false`). */
export function LoadingScreen() {
  const t = useT();
  return (
    <div className={styles.centered}>
      <Spinner size="md" label={t('primitive.spinner.label')} />
      <p className={styles.muted}>{t('shell.loading')}</p>
    </div>
  );
}
