import { useMemo } from 'react';

import {
  selectBestOralExam,
  selectLevel,
  selectStreak,
  selectWeightedAccuracy,
} from '@/application/store';
import {
  BADGE_DEFINITIONS,
  conditionProgress,
  metricsCalculator,
  QUEST_DEFINITIONS,
} from '@/domain/gamification';
import type { BadgeTier, DirectionMetrics, PlayerMetrics } from '@/domain/gamification/types';
import type { MasterySnapshot } from '@/domain/mastery/types';
import { DRILL_DIRECTIONS } from '@/domain/shared/types';
import type { DrillDirection } from '@/domain/shared/types';
import { useLocale, useLocalizedText, useT } from '@/i18n';
import type { MessageKey } from '@/i18n';
import { Chip, Inline, Panel, ProgressBar, Stack } from '@/ui/primitives';
import { useAppState, useClock, useMastery, useSelect } from '@/ui/store';

import { LoadingScreen } from './LoadingScreen';
import styles from './StatsScreen.module.css';

/** Libellés des cinq directions de drill (L16). */
const DIRECTION_LABEL_KEYS = {
  'order-to-question': 'stats.direction.orderToQuestion',
  'keyword-to-question': 'stats.direction.keywordToQuestion',
  'image-to-question': 'stats.direction.imageToQuestion',
  'number-to-question': 'stats.direction.numberToQuestion',
  'question-to-number': 'stats.direction.questionToNumber',
} as const satisfies Readonly<Record<DrillDirection, MessageKey>>;

/** Libellés des paliers de badge. */
const BADGE_TIER_KEYS = {
  bronze: 'stats.badgeTierBronze',
  silver: 'stats.badgeTierSilver',
  gold: 'stats.badgeTierGold',
  diamond: 'stats.badgeTierDiamond',
} as const satisfies Readonly<Record<BadgeTier, MessageKey>>;

/**
 * Tableau de bord.
 *
 * **Aucune règle métier n'est réimplémentée ici.** Toutes les métriques
 * proviennent de `metricsCalculator` (moyennes pondérées par `ACCURACY_CREDIT`,
 * calibration L12, `null` sans jugement de confiance) ; les badges viennent de
 * `BADGE_DEFINITIONS` et de l'état persisté. Le composant ne fait que composer
 * l'entrée attendue par le domaine (rassembler journaux, maîtrise, collection)
 * puis afficher les valeurs produites.
 *
 * Le domaine ne peut pas déduire `bestOralExam` des journaux (durée et précision
 * d'un Grand Oral) : `selectBestOralExam` et `selectWeightedAccuracy` vivent
 * désormais dans `@/application/store/selectors` — l'écran ne fait plus que
 * formater les valeurs qu'ils produisent.
 */
export function StatsScreen() {
  const t = useT();
  const locale = useLocale();
  const localize = useLocalizedText();
  const state = useAppState();
  const clock = useClock();
  const level = useSelect(selectLevel);
  const streak = useSelect(selectStreak);
  const metrics = usePlayerMetrics();

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }),
    [locale],
  );

  if (!state.ready) {
    return <LoadingScreen />;
  }

  const today = clock.dayKey(clock.now());
  const board = state.progress.player.questBoard;
  const quests = board !== null && board.dayKey === today ? board.quests : [];

  const xpSpan = level.xpToNextLevel === null ? 0 : level.xpIntoLevel + level.xpToNextLevel;
  const xpLabel =
    level.nextLevelXp === null
      ? t('stats.maxLevel')
      : t('stats.xpIntoLevel', { current: level.xpIntoLevel, span: xpSpan });

  const badges = buildBadgeViews(state.progress.player.badges, metrics);
  const unlockedBadges = badges.filter((badge) => badge.unlockedAt !== null).length;
  const overallAccuracy = metrics === null ? null : selectWeightedAccuracy(metrics);

  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{t('stats.title')}</h1>

      <Panel title={t('stats.identityTitle')}>
        <Inline gap={3} wrap align="center">
          <Chip tone="accent">{localize(level.title)}</Chip>
          <span>{t('shell.level', { level: level.level })}</span>
          <span className={styles.muted}>
            {t('stats.totalXp', { xp: state.progress.player.totalXp })}
          </span>
        </Inline>
        <ProgressBar value={level.progressRatio} label={xpLabel} />
        <p className={styles.muted}>{xpLabel}</p>
      </Panel>

      <Panel title={t('stats.streakTitle')}>
        <Inline gap={4} wrap>
          <span>{t('stats.streakCurrent', { count: streak.current })}</span>
          <span>{t('stats.streakLongest', { count: streak.longest })}</span>
          <span>{t('stats.streakFreezes', { count: streak.freezes })}</span>
        </Inline>
        {streak.frozenDays.length === 0 ? (
          <p className={styles.muted}>{t('stats.streakFrozenNone')}</p>
        ) : (
          <p className={styles.muted}>
            {t('stats.streakFrozenList', { days: streak.frozenDays.join(', ') })}
          </p>
        )}
      </Panel>

      <Panel title={t('stats.accuracyTitle')}>
        {metrics === null ? (
          <p className={styles.muted}>{t('action.failure.progressUnavailable')}</p>
        ) : (
          <Stack gap={3}>
            {overallAccuracy === null ? (
              <p>{t('stats.accuracyNoData')}</p>
            ) : (
              <p>{t('stats.overallAccuracy', { value: Math.round(overallAccuracy * 100) })}</p>
            )}
            {metrics.calibrationGap === null ? (
              <p>{t('stats.calibrationNull')}</p>
            ) : (
              <p>
                {t('stats.calibration', { value: Math.round(metrics.calibrationGap * 100) / 100 })}
              </p>
            )}
            <p className={styles.muted}>
              {t('stats.calibrationCount', { count: metrics.calibrationAnswers })}
            </p>
          </Stack>
        )}
      </Panel>

      <Panel title={t('stats.directionsTitle')}>
        {metrics === null ? (
          <p className={styles.muted}>{t('action.failure.progressUnavailable')}</p>
        ) : (
          <ul className={styles.directions}>
            {DRILL_DIRECTIONS.map((direction) => (
              <li key={direction} className={styles.direction}>
                <span className={styles.directionName}>{t(DIRECTION_LABEL_KEYS[direction])}</span>
                <DirectionFigures metrics={metrics.answersByDirection[direction]} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={t('stats.badgesTitle')}
        actions={
          <span className={styles.muted}>
            {t('stats.badgesUnlocked', { unlocked: unlockedBadges, total: badges.length })}
          </span>
        }
      >
        <ul className={styles.badges}>
          {badges.map((badge) => {
            const locked = badge.unlockedAt === null;
            const secretLocked = badge.secret && locked;
            const progressLabel = t('stats.badgeProgress', {
              current: badge.progress,
              target: badge.target,
            });
            return (
              <li key={badge.id} className={styles.badge}>
                <div className={styles.badgeHead}>
                  <span className={styles.badgeName}>
                    {secretLocked ? t('stats.badgeSecretName') : localize(badge.name)}
                  </span>
                  <Chip tone={locked ? 'muted' : 'success'}>{t(BADGE_TIER_KEYS[badge.tier])}</Chip>
                </div>
                <p className={styles.muted}>
                  {secretLocked ? t('stats.badgeSecretHint') : localize(badge.description)}
                </p>
                {badge.unlockedAt === null ? (
                  <div className={styles.badgeProgress}>
                    <ProgressBar value={badge.progress} max={badge.target} label={progressLabel} />
                    <span className={styles.muted}>{progressLabel}</span>
                  </div>
                ) : (
                  <p className={styles.badgeMeta}>
                    <time dateTime={new Date(badge.unlockedAt).toISOString()}>
                      {t('stats.badgeUnlockedOn', {
                        date: dateFormatter.format(badge.unlockedAt),
                      })}
                    </time>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title={t('stats.questsTitle')}>
        {quests.length === 0 ? (
          <p className={styles.muted}>{t('stats.questsEmpty')}</p>
        ) : (
          <ul className={styles.quests}>
            {quests.map((quest) => {
              const definition = QUEST_DEFINITIONS.find((entry) => entry.id === quest.questId);
              const title = definition === undefined ? quest.questId : localize(definition.title);
              const done = quest.completedAt !== null;
              return (
                <li key={quest.questId} className={styles.quest}>
                  <div className={styles.questHead}>
                    <span className={styles.questTitle}>{title}</span>
                    {done ? (
                      <Chip tone="success">{t('home.questDone')}</Chip>
                    ) : (
                      <span className={styles.muted}>
                        {t('home.questProgress', { current: quest.progress, target: quest.target })}
                      </span>
                    )}
                  </div>
                  {definition === undefined ? null : (
                    <p className={styles.muted}>{localize(definition.description)}</p>
                  )}
                  <ProgressBar
                    value={quest.progress}
                    max={quest.target}
                    label={title}
                    tone={done ? 'success' : 'accent'}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** Chiffres d'une direction : tentatives, précision pondérée, temps moyen. */
function DirectionFigures({ metrics }: { readonly metrics: DirectionMetrics }) {
  const t = useT();
  return (
    <Inline gap={3} wrap className={styles.directionFigures}>
      <span>{t('stats.directionAttempts', { count: metrics.attempts })}</span>
      <span>{t('stats.directionAccuracy', { value: Math.round(metrics.accuracy * 100) })}</span>
      <span>
        {metrics.averageResponseTimeMs === null
          ? t('stats.directionNoTime')
          : t('stats.directionAverageTime', {
              value: Math.round(metrics.averageResponseTimeMs / 100) / 10,
            })}
      </span>
    </Inline>
  );
}

/** Vue d'affichage d'un badge : état persisté, complété par le domaine. */
interface BadgeView {
  readonly id: string;
  readonly name: { readonly fr: string; readonly en?: string };
  readonly description: { readonly fr: string; readonly en?: string };
  readonly tier: BadgeTier;
  readonly secret: boolean;
  readonly progress: number;
  readonly target: number;
  readonly unlockedAt: number | null;
}

/**
 * Assemble la grille des 19 badges.
 *
 * L'état persisté prime (il porte la date de déblocage, définitive). Pour un
 * badge absent de l'état (fixture partielle), la progression et la cible sont
 * **demandées au domaine** (`conditionProgress`) — aucune condition n'est
 * réécrite ici, et aucune date n'est inventée.
 */
function buildBadgeViews(
  states: readonly {
    readonly badgeId: string;
    readonly progress: number;
    readonly target: number;
    readonly unlockedAt: number | null;
  }[],
  metrics: PlayerMetrics | null,
): readonly BadgeView[] {
  const byId = new Map(states.map((state) => [state.badgeId, state] as const));
  return BADGE_DEFINITIONS.map((definition) => {
    const saved = byId.get(definition.id);
    const derived =
      saved === undefined && metrics !== null
        ? conditionProgress(definition.condition, metrics)
        : null;
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      tier: definition.tier,
      secret: definition.secret,
      progress: saved?.progress ?? derived?.progress ?? 0,
      target: saved?.target ?? derived?.target ?? 1,
      unlockedAt: saved?.unlockedAt ?? null,
    };
  });
}

/** Rassemble l'entrée du calculateur de métriques depuis l'état du store. */
function usePlayerMetrics(): PlayerMetrics | null {
  const state = useAppState();
  const mastery = useMastery();
  return useMemo(() => {
    if (mastery === null) {
      return null;
    }
    const progress = state.progress;
    return metricsCalculator.compute({
      reviewLogs: progress.reviewLogs,
      sessionLogs: progress.sessionLogs,
      mastery: flattenMastery(mastery),
      hooksCount: progress.hooks.hooks.length,
      collection: progress.player.collection,
      streak: progress.player.streak,
      oralExamPasses: progress.sessionLogs.filter((log) => log.mode === 'grand-oral').length,
      bestOralExam: selectBestOralExam(progress.sessionLogs),
    });
  }, [mastery, state.progress]);
}

/** Liste plate des questions maîtrisées, attendue par `metricsCalculator`. */
function flattenMastery(mastery: MasterySnapshot) {
  return mastery.acts.flatMap((act) => act.questions);
}
