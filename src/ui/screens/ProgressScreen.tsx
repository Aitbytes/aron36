import { useState } from 'react';

import { masteryTierFor, rarityForAct } from '@/domain/gamification';
import { DEFAULT_MASTERY_CRITERIA } from '@/domain/mastery/types';
import type { MasterySnapshot, QuestionMastery } from '@/domain/mastery/types';
import { QUESTION_CATALOG } from '@/domain/questions';
import { DAY_MS, QUESTIONS_PER_ACT } from '@/domain/shared/types';
import type { ActId, EpochMs, QuestionId } from '@/domain/shared/types';
import type { CardState } from '@/domain/srs/types';
import { useLocalizedText, useT } from '@/i18n';
import type { MessageKey, Translator } from '@/i18n';
import { Button, Dialog, Panel, ProgressBar, cx } from '@/ui/primitives';
import { useActions, useAppState, useClock, useMastery } from '@/ui/store';

import { LoadingScreen } from './LoadingScreen';
import { deriveNodeState } from './nodeState';
import type { NodeState } from './nodeState';
import styles from './ProgressScreen.module.css';

/**
 * Carte de progression (L5, L14) : 3 actes × 12 nœuds, lisibles au pouce.
 *
 * Aucune règle métier n'est calculée dans l'affichage : la maîtrise (donc les
 * états « maîtrisé » et « verrouillé ») vient de `useMastery` → `MasteryEvaluator`,
 * les paliers et raretés de `@/domain/gamification`. Le seul calcul local est
 * `deriveNodeState` (`./nodeState`), faute de sélecteur exposé pour l'état d'un
 * nœud — il est pur, nommé et couvert par test.
 */

/** Clé i18n du libellé accessible d'un état de nœud. */
const NODE_STATE_LABELS: Readonly<Record<NodeState, MessageKey>> = {
  locked: 'progress.state.locked',
  available: 'progress.state.available',
  due: 'progress.state.due',
  learning: 'progress.state.learning',
  mastered: 'progress.state.mastered',
};

/** Classe CSS par état : forme et motif distincts, en plus de l'icône. */
const NODE_CLASSES: Readonly<Record<NodeState, string | undefined>> = {
  locked: styles.nodeLocked,
  available: styles.nodeAvailable,
  due: styles.nodeDue,
  learning: styles.nodeLearning,
  mastered: styles.nodeMastered,
};

/** Libellé d'échéance relatif, formaté par le traducteur (« dû dans 3 j »). */
function describeDue(card: CardState, now: EpochMs, t: Translator): string {
  if (card.phase === 'new') {
    return t('progress.detail.dueToday');
  }
  const diff = card.dueAt - now;
  if (diff > 0) {
    return t('progress.detail.dueInDays', { count: Math.ceil(diff / DAY_MS) });
  }
  const overdueDays = Math.floor((now - card.dueAt) / DAY_MS);
  return overdueDays >= 1
    ? t('progress.detail.dueOverdue', { count: overdueDays })
    : t('progress.detail.dueToday');
}

/** Icône propre à chaque état : aucune information portée par la seule couleur. */
function NodeStateIcon({ state }: { readonly state: NodeState }) {
  switch (state) {
    case 'locked':
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <rect
            x="5"
            y="10"
            width="14"
            height="10"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'available':
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'due':
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 7.5V12l3 2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'learning':
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 5a7 7 0 0 1 0 14z" fill="currentColor" />
        </svg>
      );
    case 'mastered':
      return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"
            fill="currentColor"
          />
        </svg>
      );
  }
}

/** Historique minimal d'une question : révisions et précision par direction. */
function QuestionHistory({
  question,
  card,
  t,
}: {
  readonly question: QuestionMastery | undefined;
  readonly card: CardState | undefined;
  readonly t: Translator;
}) {
  const directions = (question?.directions ?? []).filter((entry) => entry.attempts > 0);
  return (
    <>
      <p className={styles.detailMeta}>
        {card === undefined
          ? t('progress.detail.noHistory')
          : t('progress.detail.reps', { count: card.reps })}
      </p>
      {directions.length === 0 ? (
        <p className={styles.muted}>{t('progress.detail.noHistory')}</p>
      ) : (
        <>
          <p className={styles.detailSubtitle}>{t('progress.detail.directions')}</p>
          <ul className={styles.directions}>
            {directions.map((entry) => (
              <li key={entry.direction}>
                <span>{t(`direction.${entry.direction}` as MessageKey)}</span>
                <span className={styles.directionValue}>
                  {t('progress.detail.directionValue', {
                    attempts: entry.attempts,
                    accuracy: Math.round(entry.accuracy * 100),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function ProgressScreen() {
  const t = useT();
  const localize = useLocalizedText();
  const state = useAppState();
  const actions = useActions();
  const clock = useClock();
  const mastery = useMastery();
  const [selectedId, setSelectedId] = useState<QuestionId | null>(null);

  if (!state.ready) {
    return <LoadingScreen />;
  }

  const now = clock.now();
  const selectedQuestion =
    selectedId === null ? null : (QUESTION_CATALOG.byId.get(selectedId) ?? null);

  const reviewAct = (actId: ActId, unlocked: boolean): void => {
    if (!unlocked) {
      return;
    }
    const result = actions.startSession({ mode: 'review', actIds: [actId] });
    if (result.ok) {
      actions.navigate('train');
    }
  };

  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{t('progress.title')}</h1>
      <p className={styles.description}>{t('progress.description')}</p>

      {mastery === null ? (
        <p role="alert" className={styles.error}>
          {t('action.failure.progressUnavailable')}
        </p>
      ) : (
        QUESTION_CATALOG.acts.map((act) => (
          <ActMap
            key={act.id}
            actId={act.id}
            actTitle={localize(act.title)}
            mastery={mastery}
            now={now}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onReviewAct={reviewAct}
          />
        ))
      )}

      {selectedQuestion === null ? null : (
        <Dialog
          open
          onClose={() => {
            setSelectedId(null);
          }}
          title={t('progress.detail.title', { number: selectedQuestion.order })}
          closeLabel={t('progress.detail.close')}
        >
          <QuestionDetail
            questionId={selectedQuestion.id}
            mastery={mastery}
            now={now}
            onReviewQuestion={(questionId, unlocked) => {
              if (!unlocked) {
                return;
              }
              const result = actions.startSession({ mode: 'review', questionIds: [questionId] });
              if (result.ok) {
                actions.navigate('train');
              }
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

interface ActMapProps {
  readonly actId: ActId;
  readonly actTitle: string;
  readonly mastery: MasterySnapshot;
  readonly now: EpochMs;
  readonly selectedId: QuestionId | null;
  readonly onSelect: (questionId: QuestionId) => void;
  readonly onReviewAct: (actId: ActId, unlocked: boolean) => void;
}

function ActMap({ actId, actTitle, mastery, now, selectedId, onSelect, onReviewAct }: ActMapProps) {
  const t = useT();
  const localize = useLocalizedText();
  const state = useAppState();
  const actMastery = mastery.acts.find((entry) => entry.actId === actId);
  const unlocked = actMastery?.unlocked ?? actId === 1;
  const masteredCount = actMastery?.masteredCount ?? 0;
  const questionCount = actMastery?.questionCount ?? QUESTIONS_PER_ACT;
  const questions = QUESTION_CATALOG.questions.filter((question) => question.actId === actId);
  const previousAct = QUESTION_CATALOG.acts.find((entry) => entry.id === actId - 1);
  const ratio = Math.round(DEFAULT_MASTERY_CRITERIA.actUnlockRatio * 100);
  const reasonId = `act-${String(actId)}-lock-reason`;

  return (
    <Panel title={actTitle}>
      <div className={styles.actHeader}>
        <p className={styles.actProgress}>
          {t('progress.act.progress', { mastered: masteredCount, total: questionCount })}
        </p>
        <ProgressBar
          value={masteredCount}
          max={questionCount}
          label={t('progress.act.progressBar', { act: actId })}
          tone={actId === 1 ? 'act1' : actId === 2 ? 'act2' : 'act3'}
        />
      </div>

      {unlocked ? null : (
        <p id={reasonId} className={styles.lockedReason}>
          {t('progress.act.lockedReason', {
            previous: previousAct === undefined ? actId - 1 : localize(previousAct.title),
            ratio,
            act: actId,
          })}
        </p>
      )}

      <ul className={styles.nodes} aria-label={t('progress.act.list', { act: actId })}>
        {questions.map((question) => {
          const card = state.progress.cards[String(question.id)];
          const questionMastery = actMastery?.questions.find(
            (entry) => entry.questionId === question.id,
          );
          const nodeState = deriveNodeState({
            actUnlocked: unlocked,
            mastered: questionMastery?.mastered ?? false,
            card,
            now,
          });
          return (
            <li key={question.id}>
              <button
                type="button"
                className={cx(styles.node, NODE_CLASSES[nodeState])}
                data-state={nodeState}
                aria-label={t('progress.node.label', {
                  number: question.order,
                  keyword: localize(question.keyword),
                  state: t(NODE_STATE_LABELS[nodeState]),
                })}
                aria-current={selectedId === question.id ? 'true' : undefined}
                onClick={() => {
                  onSelect(question.id);
                }}
              >
                <span className={styles.nodeIndex} aria-hidden="true">
                  {question.order}
                </span>
                <span className={styles.nodeGlyph} aria-hidden="true">
                  <NodeStateIcon state={nodeState} />
                </span>
                <span className={styles.nodeKeyword} aria-hidden="true">
                  {localize(question.keyword)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className={styles.actActions}>
        <Button
          onClick={() => {
            onReviewAct(actId, unlocked);
          }}
          disabled={!unlocked}
          aria-describedby={unlocked ? undefined : reasonId}
        >
          {t('progress.act.review')}
        </Button>
        {unlocked ? null : <p className={styles.muted}>{t('progress.lockedSession')}</p>}
      </div>
    </Panel>
  );
}

interface QuestionDetailProps {
  readonly questionId: QuestionId;
  readonly mastery: MasterySnapshot | null;
  readonly now: EpochMs;
  readonly onReviewQuestion: (questionId: QuestionId, unlocked: boolean) => void;
}

function QuestionDetail({ questionId, mastery, now, onReviewQuestion }: QuestionDetailProps) {
  const t = useT();
  const localize = useLocalizedText();
  const state = useAppState();
  const question = QUESTION_CATALOG.byId.get(questionId);
  if (question === undefined) {
    return null;
  }
  const card = state.progress.cards[String(questionId)];
  const actMastery = mastery?.acts.find((entry) => entry.actId === question.actId);
  const unlocked = actMastery?.unlocked ?? question.actId === 1;
  const questionMastery = actMastery?.questions.find((entry) => entry.questionId === questionId);
  const rarity = rarityForAct(question.actId);
  const tier = card === undefined ? 1 : masteryTierFor(card.intervalDays);

  return (
    <div className={styles.detail}>
      <dl className={styles.detailList}>
        <dt>{t('progress.detail.question')}</dt>
        <dd>{localize(question.prompt)}</dd>
        <dt>{t('progress.detail.image')}</dt>
        <dd>{localize(question.mentalImage)}</dd>
        <dt>{t('progress.detail.collection')}</dt>
        <dd>
          {t('progress.detail.collectionValue', {
            rarity: t(`card.rarity.${rarity}` as MessageKey),
            tier,
          })}
        </dd>
        <dt>{t('progress.detail.due')}</dt>
        <dd>{card === undefined ? t('progress.detail.dueToday') : describeDue(card, now, t)}</dd>
        <dt>{t('progress.detail.history')}</dt>
        <dd>
          <QuestionHistory question={questionMastery} card={card} t={t} />
        </dd>
      </dl>
      <Button
        onClick={() => {
          onReviewQuestion(questionId, unlocked);
        }}
        disabled={!unlocked}
      >
        {t('progress.detail.reviewQuestion')}
      </Button>
      {unlocked ? null : <p className={styles.muted}>{t('progress.lockedSession')}</p>}
    </div>
  );
}
