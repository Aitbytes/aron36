import { useT } from '@/i18n';
import { Card, Chip, Inline } from '@/ui/primitives';

import styles from './Screens.module.css';

export interface UnderConstructionScreenProps {
  readonly title: string;
  readonly description: string;
}

/**
 * Coquille honnête : elle annonce ce qui viendra sans simuler aucune donnée.
 * Aucun compteur, aucune progression, aucune métrique inventée.
 *
 * Seul écran encore dans cet état : le Grand Oral (Phase 5).
 */
export function UnderConstructionScreen({ title, description }: UnderConstructionScreenProps) {
  const t = useT();
  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{title}</h1>
      <Card>
        <Inline gap={2} align="center">
          <Chip tone="muted">{t('screen.underConstruction')}</Chip>
        </Inline>
        <p className={styles.description}>{description}</p>
        <p className={styles.muted}>{t('screen.comingSoon')}</p>
      </Card>
    </div>
  );
}
