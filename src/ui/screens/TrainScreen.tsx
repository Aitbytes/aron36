import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';

import { selectSessionProgress } from '@/application/store';
import type {
  ErrorSignal,
  HintKind,
  SessionItem,
  SessionMode,
  SessionState,
  SessionSummary,
} from '@/domain/session/types';
import type { ConfidenceRating, LocalizedText, ReviewGrade } from '@/domain/shared/types';
import { useLocalizedText, useT } from '@/i18n';
import type { MessageKey, Translator } from '@/i18n';
import {
  Button,
  Card,
  Chip,
  Dialog,
  Inline,
  Kbd,
  Panel,
  ProgressBar,
  Stack,
  useToast,
} from '@/ui/primitives';
import {
  ACTION_FAILURE_MESSAGE_KEYS,
  useActions,
  useAppState,
  useClock,
  useSelect,
} from '@/ui/store';
import type { ActionFailureReason } from '@/ui/store';

import { SessionSummaryView } from './SessionSummaryView';
import styles from './TrainScreen.module.css';

/** Libellés des modes, alignés sur le bilan. */
const MODE_KEYS = {
  discovery: 'train.mode.discovery',
  learning: 'train.mode.learning',
  review: 'train.mode.review',
  recitation: 'train.mode.recitation',
  speed: 'train.mode.speed',
  'grand-oral': 'train.mode.grand-oral',
} as const satisfies Readonly<Record<SessionMode, MessageKey>>;

/** Libellés des crans d'indice (L9), du plus faible au plus fort. */
const HINT_KEYS = {
  initials: 'train.hint.initials',
  'first-words': 'train.hint.first-words',
  keyword: 'train.hint.keyword',
  'mental-image': 'train.hint.mental-image',
  'personal-hook': 'train.hint.personal-hook',
  'full-answer': 'train.hint.full-answer',
} as const satisfies Readonly<Record<HintKind, MessageKey>>;

/** Sens pédagogique des quatre notes de rappel. */
const GRADE_KEYS = {
  again: 'train.grade.again',
  hard: 'train.grade.hard',
  good: 'train.grade.good',
  easy: 'train.grade.easy',
} as const satisfies Readonly<Record<ReviewGrade, MessageKey>>;

/** Ordre des notes affichées, de l'échec à la réussite facile. */
const GRADES: readonly ReviewGrade[] = ['again', 'hard', 'good', 'easy'];

/** Raccourcis clavier `1`–`4` des notes. */
const GRADE_SHORTCUTS: Readonly<Record<string, ReviewGrade>> = {
  '1': 'again',
  '2': 'hard',
  '3': 'good',
  '4': 'easy',
};

/** Libellés de l'échelle de confiance (L12). */
const CONFIDENCE_KEYS = {
  1: 'train.confidence.1',
  2: 'train.confidence.2',
  3: 'train.confidence.3',
  4: 'train.confidence.4',
  5: 'train.confidence.5',
} as const satisfies Readonly<Record<ConfidenceRating, MessageKey>>;

/** Échelle complète des jugements de confiance, dans l'ordre. */
const CONFIDENCE_RATINGS: readonly ConfidenceRating[] = [1, 2, 3, 4, 5];

/** Traduction du signal d'erreur du feedback correctif (L13). */
const ERROR_KEYS = {
  none: 'train.feedback.signal.none',
  'partial-answer': 'train.feedback.signal.partial-answer',
  'wrong-question': 'train.feedback.signal.wrong-question',
  'number-confusion': 'train.feedback.signal.number-confusion',
  'keyword-confusion': 'train.feedback.signal.keyword-confusion',
  omission: 'train.feedback.signal.omission',
} as const satisfies Readonly<Record<ErrorSignal, MessageKey>>;

/** Texte de la réponse attendue : question complète ou numéro global. */
function expectedAnswerText(
  answer: SessionItem['expectedAnswer'],
  t: Translator,
  localize: (text: LocalizedText) => string,
): string {
  return answer.kind === 'number'
    ? t('train.cue.number', { number: answer.questionNumber })
    : localize(answer.text);
}

/** Signataire de soumission d'une note, partagé entre le parent et l'étape. */
type SubmitGrade = (
  grade: ReviewGrade,
  confidence: ConfidenceRating | null,
  responseTimeMs: number,
  hintsUsed: number,
) => void;

/**
 * Écran de jeu (L1, L9, L12, L13, L16, L18).
 *
 * Une seule action principale par étape, et **zéro logique métier** : la
 * précision, la durée, l'XP, les intervalles et la maîtrise viennent tous du
 * store, des sélecteurs ou des valeurs de retour des actions. L'écran se
 * contente de lire `AppState`, d'appeler `AppActions` et de traduire les refus.
 */
export function TrainScreen() {
  const t = useT();
  const localize = useLocalizedText();
  const actions = useActions();
  const state = useAppState();
  const toast = useToast();
  const progress = useSelect(selectSessionProgress);

  const session = state.session;
  const feedback = state.ui.feedback;
  const item: SessionItem | null =
    session === null ? null : (session.plan.items[session.currentIndex] ?? null);
  const sessionId = session?.plan.id ?? null;
  const requiresConfidence = session?.plan.config.requiresConfidence ?? false;

  const [lastXp, setLastXp] = useState<number | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  const reportFailure = useCallback(
    (reason: ActionFailureReason) => {
      const key = ACTION_FAILURE_MESSAGE_KEYS[reason];
      setFailure(key);
      toast.show({ tone: 'danger', title: t(key) });
    },
    [t, toast],
  );

  const submitGrade = useCallback<SubmitGrade>(
    (grade, confidence, responseTimeMs, hintsUsed) => {
      if (session === null || item === null) {
        return;
      }
      const result = actions.submitAnswer({
        sessionId: session.plan.id,
        itemId: item.id,
        grade,
        confidence: requiresConfidence ? confidence : null,
        responseTimeMs,
        hintsUsed,
        channel: 'written',
      });
      if (!result.ok) {
        reportFailure(result.reason);
        return;
      }
      setFailure(null);
      setLastXp(result.value.xp.amount);
      if (result.value.summary !== null) {
        setSummary(result.value.summary);
      }
    },
    [actions, item, reportFailure, requiresConfidence, session],
  );

  const revealAnswer = useCallback(() => {
    if (session === null) {
      return;
    }
    const result = actions.revealAnswer(session.plan.id);
    if (!result.ok) {
      reportFailure(result.reason);
      return;
    }
    setFailure(null);
  }, [actions, reportFailure, session]);

  const revealHint = useCallback(() => {
    if (session === null) {
      return;
    }
    const result = actions.revealHint(session.plan.id);
    if (!result.ok) {
      reportFailure(result.reason);
    }
  }, [actions, reportFailure, session]);

  const handleAbandonConfirm = useCallback(() => {
    setAbandonOpen(false);
    if (sessionId === null) {
      actions.navigate('home');
      return;
    }
    const result = actions.abandonSession(sessionId);
    if (!result.ok) {
      reportFailure(result.reason);
    }
    actions.navigate('home');
  }, [actions, reportFailure, sessionId]);

  const handleFinish = useCallback(
    (destination: 'home' | 'replay') => {
      if (sessionId === null) {
        actions.navigate('home');
        return;
      }
      const mode = session?.plan.mode ?? 'learning';
      const result = actions.finishSession(sessionId);
      if (!result.ok) {
        reportFailure(result.reason);
      }
      setSummary(null);
      setLastXp(null);
      if (destination === 'replay') {
        const started = actions.startSession({ mode });
        if (!started.ok) {
          reportFailure(started.reason);
          actions.navigate('home');
          return;
        }
        actions.navigate('train');
        return;
      }
      actions.navigate('home');
    },
    [actions, reportFailure, session?.plan.mode, sessionId],
  );

  // Le feedback prend le focus à l'apparition : la correction est annoncée puis
  // lisible au clavier (WCAG 2.4.3).
  useEffect(() => {
    if (feedback !== null) {
      feedbackRef.current?.focus();
    }
  }, [feedback]);

  // `Entrée` poursuit à partir du feedback.
  useEffect(() => {
    if (feedback === null) {
      return undefined;
    }
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        actions.dismissFeedback();
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [actions, feedback]);

  if (session === null) {
    return (
      <div className={styles.screen}>
        <h1 className={styles.heading}>{t('train.heading')}</h1>
        <Card>
          <p>{t('train.noSession')}</p>
          <p className={styles.muted}>{t('train.noSessionHint')}</p>
          <Button className={styles.primaryButton} onClick={() => actions.navigate('home')}>
            {t('summary.home')}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.chrome}>
        <div>
          <h1 className={styles.heading}>{t('train.heading')}</h1>
          <p className={styles.mode}>
            {t('train.modeLabel', { mode: t(MODE_KEYS[session.plan.mode]) })}
          </p>
        </div>
        <Button variant="ghost" onClick={() => setAbandonOpen(true)}>
          {t('train.abandon')}
        </Button>
      </header>

      {progress === null ? null : (
        <ProgressBar
          value={progress.index}
          max={progress.total}
          label={t('train.progressLabel', { current: progress.index, total: progress.total })}
        />
      )}

      {failure === null ? null : (
        <p role="alert" className={styles.error}>
          {t(failure)}
        </p>
      )}

      {feedback !== null ? (
        <FeedbackPanel
          panelRef={feedbackRef}
          title={feedback.answer.isPretest ? t('train.pretest.title') : t('train.feedback.title')}
          isPretest={feedback.answer.isPretest}
          correct={feedback.feedback.correct}
          verdict={t(
            feedback.feedback.correct ? 'train.feedback.correct' : 'train.feedback.incorrect',
          )}
          expectedLabel={t('train.feedback.expected')}
          expectedText={expectedAnswerText(feedback.feedback.expectedAnswer, t, localize)}
          mentalImageLabel={t('train.feedback.mentalImage')}
          mentalImage={localize(feedback.feedback.mentalImage)}
          signal={t(ERROR_KEYS[feedback.feedback.errorSignal])}
          xp={
            lastXp === null
              ? null
              : lastXp === 0
                ? t('train.xpNone')
                : t('train.xpGained', { xp: lastXp })
          }
          pretestMessage={t('train.pretest.acknowledged')}
          continueLabel={t('train.feedback.continue')}
          onContinue={() => actions.dismissFeedback()}
        />
      ) : summary !== null ? (
        <SessionSummaryView
          summary={summary}
          onReplay={() => handleFinish('replay')}
          onHome={() => handleFinish('home')}
        />
      ) : session.phase === 'completed' ? (
        <Card>
          <h2 className={styles.stepTitle}>{t('summary.title')}</h2>
          <Button className={styles.primaryButton} onClick={() => handleFinish('home')}>
            {t('summary.home')}
          </Button>
        </Card>
      ) : item === null ? null : (
        <ItemStage
          key={item.id}
          session={session}
          item={item}
          requiresConfidence={requiresConfidence}
          onSubmit={submitGrade}
          onRevealAnswer={revealAnswer}
          onRevealHint={revealHint}
        />
      )}

      <Dialog
        open={abandonOpen}
        onClose={() => setAbandonOpen(false)}
        title={t('train.abandonTitle')}
        closeLabel={t('train.close')}
        footer={
          <Inline gap={3} wrap>
            <Button variant="danger" onClick={handleAbandonConfirm}>
              {t('train.abandonConfirm')}
            </Button>
            <Button variant="secondary" onClick={() => setAbandonOpen(false)}>
              {t('train.abandonCancel')}
            </Button>
          </Inline>
        }
      >
        <p>{t('train.abandonBody')}</p>
      </Dialog>
    </div>
  );
}

interface ItemStageProps {
  readonly session: SessionState;
  readonly item: SessionItem;
  readonly requiresConfidence: boolean;
  readonly onSubmit: SubmitGrade;
  readonly onRevealAnswer: () => void;
  readonly onRevealHint: () => void;
}

/**
 * Étape d'un item : question, indices, confiance, saisie puis notation.
 *
 * Le composant est **remonté pour chaque item** (`key={item.id}`) : la saisie,
 * la confiance et le chronomètre repartent donc de zéro sans effet de bord.
 */
function ItemStage({
  session,
  item,
  requiresConfidence,
  onSubmit,
  onRevealAnswer,
  onRevealHint,
}: ItemStageProps) {
  const t = useT();
  const localize = useLocalizedText();
  const clock = useClock();
  const numberHintId = useId();
  const shownAtRef = useRef<number>(clock.now());

  const [confidence, setConfidence] = useState<ConfidenceRating | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [numberText, setNumberText] = useState('');
  const [answerShown, setAnswerShown] = useState(false);

  const revealed = answerShown || session.phase === 'revealed';

  const grade = useCallback(
    (value: ReviewGrade) => {
      onSubmit(
        value,
        confidence,
        Math.max(0, clock.now() - shownAtRef.current),
        session.revealedHints,
      );
    },
    [clock, confidence, onSubmit, session.revealedHints],
  );

  const handleReveal = useCallback(() => {
    if (requiresConfidence) {
      // L12 : la confiance précède la révélation. Le cas d'usage `submitAnswer`
      // enregistre confiance + révélation + note en une seule transition
      // atomique ; `revealAnswer` la refuserait (`confidence-required`), on
      // présente donc la réponse ici et la transition est différée.
      if (confidence !== null) {
        setAnswerShown(true);
      }
      return;
    }
    onRevealAnswer();
  }, [confidence, onRevealAnswer, requiresConfidence]);

  const handleSubmitForm = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (item.isPretest) {
        grade('good');
        return;
      }
      if (!revealed) {
        handleReveal();
      }
    },
    [grade, handleReveal, item.isPretest, revealed],
  );

  // Raccourcis `1`–`4` pendant la notation.
  useEffect(() => {
    if (!revealed || item.exerciseKind !== 'production') {
      return undefined;
    }
    const handler = (event: KeyboardEvent): void => {
      const value = GRADE_SHORTCUTS[event.key];
      if (value === undefined) {
        return;
      }
      event.preventDefault();
      grade(value);
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [grade, item.exerciseKind, revealed]);

  return (
    <Card className={styles.stage}>
      <div aria-live="polite">
        <CueView item={item} />
      </div>

      {item.isPretest ? (
        <div className={styles.pretestLead}>
          <h2 className={styles.stepTitle}>{t('train.pretest.title')}</h2>
          <p>
            <Chip tone="accent">{t('train.pretest.badge')}</Chip> {t('train.pretest.lead')}
          </p>
        </div>
      ) : null}

      <HintsPanel
        hints={item.hints}
        revealedHints={session.revealedHints}
        onReveal={onRevealHint}
      />

      {requiresConfidence && !revealed ? (
        <section className={styles.confidence} aria-labelledby="confidence-title">
          <h2 id="confidence-title" className={styles.stepTitle}>
            {t('train.confidence.title')}
          </h2>
          <Inline gap={2} wrap>
            {CONFIDENCE_RATINGS.map((rating) => (
              <Button
                key={rating}
                variant={confidence === rating ? 'primary' : 'secondary'}
                aria-pressed={confidence === rating}
                onClick={() => setConfidence(rating)}
              >
                {t(CONFIDENCE_KEYS[rating])}
              </Button>
            ))}
          </Inline>
        </section>
      ) : null}

      {item.isPretest ? (
        <form onSubmit={handleSubmitForm} className={styles.form}>
          <AnswerField
            item={item}
            answerText={answerText}
            numberText={numberText}
            numberHintId={numberHintId}
            onAnswerChange={setAnswerText}
            onNumberChange={setNumberText}
          />
          <Button type="submit" size="lg">
            {t('train.pretest.submit')}
          </Button>
        </form>
      ) : item.exerciseKind === 'discrimination' ? (
        <section className={styles.options} aria-labelledby="options-title">
          <h2 id="options-title" className={styles.stepTitle}>
            {t('train.discrimination.title')}
          </h2>
          <Stack gap={3}>
            {item.options.map((option) => (
              <Button
                key={option.id}
                variant="secondary"
                block
                disabled={requiresConfidence && confidence === null}
                onClick={() => grade(option.id === item.correctOptionId ? 'good' : 'again')}
              >
                {localize(option.label)}
              </Button>
            ))}
          </Stack>
        </section>
      ) : revealed ? (
        <section className={styles.revealed} aria-live="polite">
          <h2 className={styles.stepTitle}>{t('train.expected.title')}</h2>
          <p className={styles.expected}>{expectedAnswerText(item.expectedAnswer, t, localize)}</p>
          <p className={styles.mentalImage}>
            <span className={styles.label}>{t('train.feedback.mentalImage')}</span>{' '}
            {localize(item.mentalImage)}
          </p>
          <div className={styles.grades}>
            <h2 className={styles.stepTitle}>{t('train.grade.title')}</h2>
            <Inline gap={3} wrap>
              {GRADES.map((value, index) => (
                <Button
                  key={value}
                  variant={value === 'again' ? 'danger' : 'secondary'}
                  onClick={() => grade(value)}
                >
                  {`${String(index + 1)}. ${t(GRADE_KEYS[value])}`}
                </Button>
              ))}
            </Inline>
            <p className={styles.shortcut}>
              {t('train.grade.shortcut')} <Kbd>1</Kbd>–<Kbd>4</Kbd> {t('train.grade.shortcutKeys')}
            </p>
          </div>
        </section>
      ) : (
        <form onSubmit={handleSubmitForm} className={styles.form}>
          <AnswerField
            item={item}
            answerText={answerText}
            numberText={numberText}
            numberHintId={numberHintId}
            onAnswerChange={setAnswerText}
            onNumberChange={setNumberText}
          />
          <div className={styles.reveal}>
            {requiresConfidence && confidence === null ? (
              <p id={`${numberHintId}-confidence`} className={styles.muted}>
                {t('train.confidence.required')}
              </p>
            ) : null}
            <Button
              type="submit"
              size="lg"
              disabled={requiresConfidence && confidence === null}
              aria-describedby={
                requiresConfidence && confidence === null ? `${numberHintId}-confidence` : undefined
              }
            >
              {t('train.reveal')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

interface CueViewProps {
  readonly item: SessionItem;
}

/** Rend la zone question selon la direction et le type d'indice (L16). */
function CueView({ item }: CueViewProps) {
  const t = useT();
  const localize = useLocalizedText();
  const cue = item.cue;
  switch (cue.kind) {
    case 'order':
      return (
        <div className={styles.cue}>
          <p className={styles.cueOrder}>
            {t('train.cue.order', { act: cue.actId, position: cue.positionInAct })}
          </p>
        </div>
      );
    case 'keyword':
      return (
        <div className={styles.cue}>
          <p className={styles.label}>{t('train.cue.keyword')}</p>
          <p className={styles.keyword}>{localize(cue.text)}</p>
        </div>
      );
    case 'image':
      return (
        <div className={styles.cue}>
          <p className={styles.label}>{t('train.cue.image')}</p>
          <p className={styles.image}>{localize(cue.text)}</p>
        </div>
      );
    case 'number':
      return (
        <div className={styles.cue}>
          <p className={styles.number}>{t('train.cue.number', { number: cue.questionNumber })}</p>
        </div>
      );
    case 'question':
      return (
        <div className={styles.cue}>
          <p className={styles.label}>{t('train.cue.question')}</p>
          <p className={styles.question}>{localize(cue.text)}</p>
          <p className={styles.instruction}>{t('train.cue.questionInstruction')}</p>
        </div>
      );
  }
}

interface AnswerFieldProps {
  readonly item: SessionItem;
  readonly answerText: string;
  readonly numberText: string;
  readonly numberHintId: string;
  readonly onAnswerChange: (value: string) => void;
  readonly onNumberChange: (value: string) => void;
}

/** Champ de saisie : texte libre (question) ou numérique (1..36). */
function AnswerField({
  item,
  answerText,
  numberText,
  numberHintId,
  onAnswerChange,
  onNumberChange,
}: AnswerFieldProps) {
  const t = useT();
  if (item.expectedAnswer.kind === 'number') {
    return (
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${numberHintId}-input`}>
          {t('train.numberLabel')}
        </label>
        <input
          id={`${numberHintId}-input`}
          className={styles.input}
          type="number"
          inputMode="numeric"
          min={1}
          max={36}
          value={numberText}
          onChange={(event) => onNumberChange(event.target.value)}
          aria-describedby={numberHintId}
        />
        <p id={numberHintId} className={styles.muted}>
          {t('train.numberHint')}
        </p>
      </div>
    );
  }
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={`${numberHintId}-answer`}>
        {t('train.answerLabel')}
      </label>
      <input
        id={`${numberHintId}-answer`}
        className={styles.input}
        type="text"
        value={answerText}
        onChange={(event) => onAnswerChange(event.target.value)}
        placeholder={t('train.answerPlaceholder')}
      />
    </div>
  );
}

interface HintsPanelProps {
  readonly hints: SessionItem['hints'];
  readonly revealedHints: number;
  readonly onReveal: () => void;
}

/** Échelle d'indices (L9) : empilement du plus faible au plus fort, à la demande. */
function HintsPanel({ hints, revealedHints, onReveal }: HintsPanelProps) {
  const t = useT();
  const localize = useLocalizedText();
  if (hints.length === 0) {
    return (
      <Panel title={t('train.hints.title')} titleAs="h2" className={styles.hints}>
        <p className={styles.muted}>{t('train.hints.none')}</p>
      </Panel>
    );
  }
  const revealed = hints.slice(0, revealedHints);
  const exhausted = revealedHints >= hints.length;
  return (
    <Panel title={t('train.hints.title')} titleAs="h2" className={styles.hints}>
      <p className={styles.hintCounter}>{t('train.hints.used', { count: revealedHints })}</p>
      {revealed.length === 0 ? null : (
        <ol className={styles.hintList}>
          {revealed.map((hint, index) => (
            <li key={`${hint.kind}-${String(index)}`} className={styles.hint}>
              <span className={styles.label}>{t(HINT_KEYS[hint.kind])}</span>{' '}
              {localize(hint.content)}
            </li>
          ))}
        </ol>
      )}
      {exhausted ? (
        <p className={styles.muted}>{t('train.hints.exhausted')}</p>
      ) : (
        <Button variant="secondary" onClick={onReveal}>
          {t('train.hints.reveal')}
        </Button>
      )}
    </Panel>
  );
}

interface FeedbackPanelProps {
  readonly panelRef: RefObject<HTMLDivElement | null>;
  readonly title: string;
  readonly isPretest: boolean;
  readonly correct: boolean;
  readonly verdict: string;
  readonly expectedLabel: string;
  readonly expectedText: string;
  readonly mentalImageLabel: string;
  readonly mentalImage: string;
  readonly signal: string;
  readonly xp: string | null;
  readonly pretestMessage: string;
  readonly continueLabel: string;
  readonly onContinue: () => void;
}

/** Feedback correctif (L13) ; un prétest (L18) n'affiche aucune correction. */
function FeedbackPanel({
  panelRef,
  title,
  isPretest,
  correct,
  verdict,
  expectedLabel,
  expectedText,
  mentalImageLabel,
  mentalImage,
  signal,
  xp,
  pretestMessage,
  continueLabel,
  onContinue,
}: FeedbackPanelProps) {
  return (
    <div ref={panelRef} tabIndex={-1} role="status" className={styles.feedback}>
      <h2 className={styles.stepTitle}>{title}</h2>
      {isPretest ? (
        <p className={styles.pretestLead}>{pretestMessage}</p>
      ) : (
        <>
          <p className={correct ? styles.correct : styles.incorrect}>{verdict}</p>
          <p className={styles.expectedLine}>
            <span className={styles.label}>{expectedLabel}</span> {expectedText}
          </p>
          <p>
            <span className={styles.label}>{mentalImageLabel}</span> {mentalImage}
          </p>
          <p className={styles.signal}>{signal}</p>
        </>
      )}
      {xp === null ? null : <p className={styles.xp}>{xp}</p>}
      <Button className={styles.primaryButton} onClick={onContinue}>
        {continueLabel}
      </Button>
    </div>
  );
}
