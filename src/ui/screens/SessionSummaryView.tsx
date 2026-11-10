import type { DrillDirection } from '@/domain/shared/types';
import type { SessionMode, SessionSummary } from '@/domain/session/types';
import { useT } from '@/i18n';
import type { MessageKey } from '@/i18n';
import { Button, Card, Inline, Panel, ProgressBar, Stack } from '@/ui/primitives';

import styles from './SessionSummaryView.module.css';

/** Libellés localisés des modes de session, alignés sur le chrome du jeu. */
const MODE_KEYS = {
  discovery: 'train.mode.discovery',
  learning: 'train.mode.learning',
  review: 'train.mode.review',
  recitation: 'train.mode.recitation',
  speed: 'train.mode.speed',
  'grand-oral': 'train.mode.grand-oral',
} as const satisfies Readonly<Record<SessionMode, MessageKey>>;

/** Libellés des cinq directions de drill (L16). */
const DIRECTION_KEYS = {
  'order-to-question': 'train.direction.order-to-question',
  'keyword-to-question': 'train.direction.keyword-to-question',
  'image-to-question': 'train.direction.image-to-question',
  'number-to-question': 'train.direction.number-to-question',
  'question-to-number': 'train.direction.question-to-number',
} as const satisfies Readonly<Record<DrillDirection, MessageKey>>;

/** Les cinq directions, dans l'ordre d'affichage du bilan. */
const DIRECTIONS: readonly DrillDirection[] = [
  'order-to-question',
  'keyword-to-question',
  'image-to-question',
  'number-to-question',
  'question-to-number',
];

export interface SessionSummaryViewProps {
  /**
   * Vue agrégée **fournie** par le cas d'usage (`finishSession` / `submitAnswer`).
   * L'écran ne dérive ni précision, ni XP, ni durée : il formate ce contrat.
   */
  readonly summary: SessionSummary;
  readonly onReplay: () => void;
  readonly onHome: () => void;
}

/** Mise en forme d'une durée en minutes/secondes (affichage seul). */
function splitDuration(durationMs: number): { readonly minutes: number; readonly seconds: number } {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  return { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
}

/**
 * Bilan de session : toutes les valeurs affichées viennent de `summary`, aucune
 * n'est recalculée côté interface (source de vérité unique, revue Phase 3).
 */
export function SessionSummaryView({ summary, onReplay, onHome }: SessionSummaryViewProps) {
  const t = useT();
  const { minutes, seconds } = splitDuration(summary.durationMs);

  return (
    <div className={styles.summary}>
      <h1 className={styles.title}>{t('summary.title')}</h1>
      <p className={styles.mode}>{t('summary.mode', { mode: t(MODE_KEYS[summary.mode]) })}</p>

      <div className={styles.grid}>
        <Card className={styles.metric}>
          <span className={styles.metricLabel}>{t('summary.accuracy')}</span>
          <span className={styles.metricValue}>
            {t('summary.accuracyValue', { percent: Math.round(summary.accuracy * 100) })}
          </span>
          <span className={styles.metricDetail}>
            {t('summary.correctCount', {
              correct: summary.correctCount,
              total: summary.answeredCount,
            })}
          </span>
        </Card>
        <Card className={styles.metric}>
          <span className={styles.metricLabel}>{t('summary.xp')}</span>
          <span className={styles.metricValue}>
            {t('summary.xpValue', { xp: summary.xpAwarded })}
          </span>
        </Card>
        <Card className={styles.metric}>
          <span className={styles.metricLabel}>{t('summary.duration')}</span>
          <span className={styles.metricValue}>
            {t('summary.durationValue', { minutes, seconds })}
          </span>
        </Card>
        <Card className={styles.metric}>
          <span className={styles.metricLabel}>{t('summary.spoken')}</span>
          <span className={styles.metricValue}>
            {t('summary.spokenValue', { count: summary.spokenCount })}
          </span>
        </Card>
      </div>

      <Panel title={t('summary.byDirection')} className={styles.directions}>
        <Stack gap={3}>
          {DIRECTIONS.map((direction) => {
            const bucket = summary.byDirection[direction];
            return (
              <div key={direction} className={styles.direction}>
                <div className={styles.directionHead}>
                  <span className={styles.directionLabel}>{t(DIRECTION_KEYS[direction])}</span>
                  <span className={styles.directionValue}>
                    {t('summary.direction.attempts', {
                      attempts: bucket.attempts,
                      correct: bucket.correct,
                    })}
                  </span>
                </div>
                <ProgressBar
                  value={bucket.correct}
                  max={bucket.attempts === 0 ? 1 : bucket.attempts}
                  label={t(DIRECTION_KEYS[direction])}
                />
              </div>
            );
          })}
        </Stack>
      </Panel>

      <Inline gap={3} wrap align="center" className={styles.actions}>
        <Button onClick={onReplay}>{t('summary.replay')}</Button>
        <Button variant="secondary" onClick={onHome}>
          {t('summary.home')}
        </Button>
      </Inline>
    </div>
  );
}
