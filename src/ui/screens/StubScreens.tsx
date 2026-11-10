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

/** Écran d'entraînement — implémenté par le lot « écran de jeu ». */
export function TrainScreen() {
  const t = useT();
  return <UnderConstructionScreen title={t('train.title')} description={t('train.description')} />;
}

/** Écran de collection — implémenté par le lot « carte de progression ». */
export function CollectionScreen() {
  const t = useT();
  return (
    <UnderConstructionScreen
      title={t('collection.title')}
      description={t('collection.description')}
    />
  );
}

/** Écran de statistiques — implémenté par le lot « tableau de bord ». */
export function StatsScreen() {
  const t = useT();
  return <UnderConstructionScreen title={t('stats.title')} description={t('stats.description')} />;
}

/** Écran de réglages — implémenté par le lot « tableau de bord ». */
export function SettingsScreen() {
  const t = useT();
  return (
    <UnderConstructionScreen title={t('settings.title')} description={t('settings.description')} />
  );
}
