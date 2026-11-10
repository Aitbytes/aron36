import { useCallback, useState } from 'react';

import { selectDueCount, selectLevel, selectStreak } from '@/application/store';
import type { AppState } from '@/application/store';
import { QUEST_DEFINITIONS } from '@/domain/gamification';
import { QUESTION_CATALOG } from '@/domain/questions';
import { useLocalizedText, useT } from '@/i18n';
import { Button, Chip, Panel, ProgressBar, Stack } from '@/ui/primitives';
import {
  ACTION_FAILURE_MESSAGE_KEYS,
  useActions,
  useAppState,
  useClock,
  useMastery,
  useSelect,
} from '@/ui/store';
import type { ActionFailureReason } from '@/ui/store';

import { LoadingScreen } from './LoadingScreen';
import { RecoveryBanner } from './RecoveryBanner';
import styles from './Screens.module.css';

/**
 * Écran d'accueil, fonctionnel dès la Phase 4-A.
 *
 * Tout ce qui est affiché vient du store ou du domaine, jamais d'un calcul local :
 * niveau et rang (`selectLevel` → `LevelCalculator`), série (`selectStreak`),
 * cartes dues (`selectDueCount`, horloge injectée), quêtes persistées, prochain
 * acte à débloquer (`useMastery` → `MasteryEvaluator`). L'UI ne dérive aucune
 * valeur métier.
 */
export function HomeScreen() {
  const t = useT();
  const localize = useLocalizedText();
  const state = useAppState();
  const actions = useActions();
  const clock = useClock();
  const level = useSelect(selectLevel);
  const streak = useSelect(selectStreak);
  const dueCount = useSelect(
    useCallback((current: AppState) => selectDueCount(current, clock.now()), [clock]),
  );
  const [startFailure, setStartFailure] = useState<ActionFailureReason | null>(null);
  // Progression indisponible pendant une récupération : l'instantané est `null`
  // et le bloc « prochain acte » affiche seulement ce qu'il peut prouver.
  const mastery = useMastery();

  const handleStart = useCallback(() => {
    const result = actions.startSession({ mode: dueCount > 0 ? 'review' : 'learning' });
    if (result.ok) {
      setStartFailure(null);
      actions.navigate('train');
      return;
    }
    setStartFailure(result.reason);
  }, [actions, dueCount]);

  if (!state.ready) {
    return <LoadingScreen />;
  }

  const now = clock.now();
  const today = clock.dayKey(now);
  const questBoard = state.progress.player.questBoard;
  const quests = questBoard !== null && questBoard.dayKey === today ? questBoard.quests : [];

  const nextActId = mastery?.nextActToUnlock ?? null;
  const nextAct =
    nextActId === null ? null : (QUESTION_CATALOG.acts.find((a) => a.id === nextActId) ?? null);
  const previousAct =
    nextActId === null ? null : (mastery?.acts.find((a) => a.actId === nextActId - 1) ?? null);
  const previousActTitle =
    previousAct === null
      ? null
      : (QUESTION_CATALOG.acts.find((a) => a.id === previousAct.actId)?.title ?? null);
  const xpSpan = level.xpToNextLevel === null ? 0 : level.xpIntoLevel + level.xpToNextLevel;
  const xpLabel =
    level.nextLevelXp === null
      ? t('shell.maxLevel')
      : t('shell.xpInLevel', { current: level.xpIntoLevel, span: xpSpan });

  return (
    <div className={styles.home}>
      <h1 className={styles.title}>{t('home.title')}</h1>

      {state.lastError === null ? null : <RecoveryBanner error={state.lastError} />}

      <Panel title={t('home.heroTitle')}>
        <div className={styles.hero}>
          <p className={styles.lead}>{t('home.heroLead')}</p>
          <p className={styles.due}>
            {dueCount === 0 ? t('home.dueNone') : t('home.dueCount', { count: dueCount })}
          </p>
          <Button size="lg" onClick={handleStart}>
            {t('home.startSession')}
          </Button>
          {startFailure === null ? null : (
            <p role="alert" className={styles.error}>
              {t(ACTION_FAILURE_MESSAGE_KEYS[startFailure])}
            </p>
          )}
        </div>
      </Panel>

      <Panel title={t('home.progressTitle')}>
        <div className={styles.progress}>
          <div className={styles.progressRow}>
            <div className={styles.metaRow}>
              <Chip tone="accent">{localize(level.title)}</Chip>
              <span>{t('shell.level', { level: level.level })}</span>
            </div>
            <ProgressBar value={level.progressRatio} label={xpLabel} />
            <p className={styles.muted}>{xpLabel}</p>
          </div>
          <div className={styles.metaRow}>
            <span>{t('shell.streak', { count: streak.current })}</span>
            <span>{t('shell.freezes', { count: streak.freezes })}</span>
          </div>
        </div>
      </Panel>

      <Panel title={t('home.questsTitle')}>
        {quests.length === 0 ? (
          <p className={styles.muted}>{t('home.questsEmpty')}</p>
        ) : (
          <ul className={styles.quests}>
            {quests.map((quest) => {
              const definition = QUEST_DEFINITIONS.find((entry) => entry.id === quest.questId);
              const questTitle =
                definition === undefined ? quest.questId : localize(definition.title);
              const done = quest.completedAt !== null;
              return (
                <li key={quest.questId} className={styles.quest}>
                  <div className={styles.questHead}>
                    <span className={styles.questTitle}>{questTitle}</span>
                    {done ? (
                      <Chip tone="success">{t('home.questDone')}</Chip>
                    ) : (
                      <span className={styles.questProgress}>
                        {t('home.questProgress', { current: quest.progress, target: quest.target })}
                      </span>
                    )}
                  </div>
                  <ProgressBar
                    value={quest.progress}
                    max={quest.target}
                    label={questTitle}
                    tone={done ? 'success' : 'accent'}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title={t('home.nextActTitle')}>
        {nextActId === null || nextAct === null ? (
          <p className={styles.muted}>{t('home.nextActAllUnlocked')}</p>
        ) : (
          <Stack gap={3}>
            {previousAct === null || previousActTitle === null ? (
              <p>{t('home.actLabel', { act: nextAct.order })}</p>
            ) : (
              <p>
                {t('home.nextActRequirement', {
                  act: localize(nextAct.title),
                  previous: localize(previousActTitle),
                  ratio: Math.round(previousAct.ratio * 100),
                })}
              </p>
            )}
            {previousAct === null ? null : (
              <ProgressBar
                value={previousAct.masteredCount}
                max={previousAct.questionCount}
                label={t('home.nextActProgress', {
                  mastered: previousAct.masteredCount,
                  total: previousAct.questionCount,
                })}
              />
            )}
          </Stack>
        )}
      </Panel>
    </div>
  );
}
