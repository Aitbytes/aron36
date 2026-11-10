import { useMemo, useState } from 'react';

import { actOfQuestion } from '@/domain/gamification';
import type { CardRarity, CollectionEntry } from '@/domain/gamification/types';
import { QUESTION_CATALOG } from '@/domain/questions';
import { QUESTION_COUNT } from '@/domain/shared/types';
import type { ActId, LocaleCode, QuestionId } from '@/domain/shared/types';
import type { QuestionItem } from '@/domain/questions/types';
import { useLocale, useLocalizedText, useT } from '@/i18n';
import type { MessageKey } from '@/i18n';
import { Chip, Dialog, Panel, cx } from '@/ui/primitives';
import { useAppState } from '@/ui/store';

import { LoadingScreen } from './LoadingScreen';
import styles from './CollectionScreen.module.css';

/**
 * Album des 36 cartes de collection (L14, § 8.6).
 *
 * Les entrées viennent **telles quelles** de `player.collection.entries` : l'UI
 * ne décide ni de la rareté ni du palier, déjà écrits par le domaine. Une carte
 * verrouillée n'expose ni le texte ni l'image de sa question (pas de spoiler) :
 * seules les cartes obtenues ouvrent un détail.
 */

type ActFilter = 'all' | ActId;
type StateFilter = 'all' | 'obtained' | 'locked';
type TierFilter = 'all' | 1 | 2 | 3 | 4 | 5;
type SortKey = 'number' | 'obtained' | 'tier';

interface CardView {
  readonly question: QuestionItem;
  readonly entry: CollectionEntry | null;
}

/** Clé i18n du libellé d'une rareté. */
function rarityKey(rarity: CardRarity): MessageKey {
  return `card.rarity.${rarity}` as MessageKey;
}

/** Date d'obtention formatée pour l'affichage (jamais stockée). */
function formatDate(epochMs: number, locale: LocaleCode): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(epochMs));
}

/** Tri simple, déterministe : les cartes verrouillées finissent toujours en fin de liste. */
function sortCards(cards: readonly CardView[], sortKey: SortKey): readonly CardView[] {
  const copy = [...cards];
  if (sortKey === 'number') {
    copy.sort((left, right) => left.question.order - right.question.order);
  } else if (sortKey === 'obtained') {
    copy.sort(
      (left, right) =>
        (left.entry?.obtainedAt ?? Number.POSITIVE_INFINITY) -
          (right.entry?.obtainedAt ?? Number.POSITIVE_INFINITY) ||
        left.question.order - right.question.order,
    );
  } else {
    copy.sort(
      (left, right) =>
        (right.entry?.masteryTier ?? 0) - (left.entry?.masteryTier ?? 0) ||
        left.question.order - right.question.order,
    );
  }
  return copy;
}

export function CollectionScreen() {
  const t = useT();
  const localize = useLocalizedText();
  const state = useAppState();
  const [actFilter, setActFilter] = useState<ActFilter>('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('number');
  const [selectedId, setSelectedId] = useState<QuestionId | null>(null);

  const entries = state.progress.player.collection.entries;
  const entriesById = useMemo(() => {
    const map = new Map<QuestionId, CollectionEntry>();
    for (const entry of entries) {
      map.set(entry.questionId, entry);
    }
    return map;
  }, [entries]);

  const filtered = useMemo(() => {
    const cards: CardView[] = QUESTION_CATALOG.questions.map((question) => ({
      question,
      entry: entriesById.get(question.id) ?? null,
    }));
    const kept = cards.filter((card) => {
      if (actFilter !== 'all' && card.question.actId !== actFilter) {
        return false;
      }
      if (stateFilter === 'obtained' && card.entry === null) {
        return false;
      }
      if (stateFilter === 'locked' && card.entry !== null) {
        return false;
      }
      if (tierFilter !== 'all' && card.entry?.masteryTier !== tierFilter) {
        return false;
      }
      return true;
    });
    return sortCards(kept, sortKey);
  }, [entriesById, actFilter, stateFilter, tierFilter, sortKey]);

  if (!state.ready) {
    return <LoadingScreen />;
  }

  const selected = selectedId === null ? null : (entriesById.get(selectedId) ?? null);
  const selectedQuestion =
    selected === null ? null : (QUESTION_CATALOG.byId.get(selected.questionId) ?? null);

  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{t('collection.title')}</h1>
      <p className={styles.counter}>
        {t('collection.counter', { obtained: entries.length, total: QUESTION_COUNT })}
      </p>

      <Panel title={t('collection.perActTitle')} titleAs="h2">
        <ul className={styles.acts}>
          {QUESTION_CATALOG.acts.map((act) => {
            const obtained = entries.filter(
              (entry) => actOfQuestion(entry.questionId) === act.id,
            ).length;
            return (
              <li key={act.id}>
                {t('collection.actSummary', {
                  act: act.order,
                  obtained,
                  total: QUESTION_CATALOG.questions.filter((question) => question.actId === act.id)
                    .length,
                })}
              </li>
            );
          })}
        </ul>
      </Panel>

      {entries.length === 0 ? (
        <p className={styles.empty}>{t('collection.empty')}</p>
      ) : (
        <>
          <div className={styles.filters} role="group" aria-label={t('collection.albumLabel')}>
            <label className={styles.filter}>
              <span>{t('collection.filter.act')}</span>
              <select
                value={actFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  setActFilter(value === 'all' ? 'all' : (Number(value) as ActId));
                }}
              >
                <option value="all">{t('collection.filter.all')}</option>
                {QUESTION_CATALOG.acts.map((act) => (
                  <option key={act.id} value={act.id}>
                    {localize(act.title)}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.filter}>
              <span>{t('collection.filter.state')}</span>
              <select
                value={stateFilter}
                onChange={(event) => {
                  setStateFilter(event.target.value as StateFilter);
                }}
              >
                <option value="all">{t('collection.filter.all')}</option>
                <option value="obtained">{t('collection.state.obtained')}</option>
                <option value="locked">{t('collection.state.locked')}</option>
              </select>
            </label>

            <label className={styles.filter}>
              <span>{t('collection.filter.tier')}</span>
              <select
                value={String(tierFilter)}
                onChange={(event) => {
                  const value = event.target.value;
                  setTierFilter(value === 'all' ? 'all' : (Number(value) as 1 | 2 | 3 | 4 | 5));
                }}
              >
                <option value="all">{t('collection.filter.all')}</option>
                {([1, 2, 3, 4, 5] as const).map((tier) => (
                  <option key={tier} value={tier}>
                    {t('card.tier', { tier })}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.filter}>
              <span>{t('collection.sort.label')}</span>
              <select
                value={sortKey}
                onChange={(event) => {
                  setSortKey(event.target.value as SortKey);
                }}
              >
                <option value="number">{t('collection.sort.number')}</option>
                <option value="obtained">{t('collection.sort.obtained')}</option>
                <option value="tier">{t('collection.sort.tier')}</option>
              </select>
            </label>
          </div>

          {filtered.length === 0 ? (
            <p className={styles.muted}>{t('collection.noneForFilter')}</p>
          ) : (
            <ul className={styles.grid} aria-label={t('collection.albumLabel')}>
              {filtered.map((card) =>
                card.entry === null ? (
                  <li key={card.question.id} className={cx(styles.card, styles.cardLocked)}>
                    <span className={styles.lockedMark} aria-hidden="true">
                      ?
                    </span>
                    <span className={styles.lockedHint}>{t('collection.lockedHint')}</span>
                  </li>
                ) : (
                  <li key={card.question.id}>
                    <button
                      type="button"
                      className={cx(
                        styles.card,
                        styles.cardObtained,
                        styles[`rarity_${card.entry.rarity}`],
                      )}
                      aria-label={t('collection.cardObtainedLabel', {
                        number: card.question.order,
                        rarity: t(rarityKey(card.entry.rarity)),
                        tier: card.entry.masteryTier,
                      })}
                      aria-current={selectedId === card.question.id ? 'true' : undefined}
                      onClick={() => {
                        setSelectedId(card.question.id);
                      }}
                    >
                      <span className={styles.cardIndex} aria-hidden="true">
                        {card.question.order}
                      </span>
                      <span className={styles.cardKeyword} aria-hidden="true">
                        {localize(card.question.keyword)}
                      </span>
                      <span className={styles.cardTier} aria-hidden="true">
                        {t('card.tier', { tier: card.entry.masteryTier })}
                      </span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          )}
        </>
      )}

      {selected === null || selectedQuestion === null ? null : (
        <Dialog
          open
          onClose={() => {
            setSelectedId(null);
          }}
          title={t('collection.detail.title', { number: selectedQuestion.order })}
          closeLabel={t('collection.detail.close')}
        >
          <CardDetail entry={selected} question={selectedQuestion} />
        </Dialog>
      )}
    </div>
  );
}

function CardDetail({
  entry,
  question,
}: {
  readonly entry: CollectionEntry;
  readonly question: QuestionItem;
}) {
  const t = useT();
  const localize = useLocalizedText();
  const locale = useLocale();
  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <Chip tone="accent">{t(rarityKey(entry.rarity))}</Chip>
        <Chip tone="success">{t('card.tier', { tier: entry.masteryTier })}</Chip>
      </div>
      <dl className={styles.detailList}>
        <dt>{t('collection.detail.question')}</dt>
        <dd>{localize(question.prompt)}</dd>
        <dt>{t('collection.detail.image')}</dt>
        <dd>{localize(question.mentalImage)}</dd>
        <dt>{t('collection.detail.rarity')}</dt>
        <dd>{t(rarityKey(entry.rarity))}</dd>
        <dt>{t('collection.detail.tier')}</dt>
        <dd>{t('card.tier', { tier: entry.masteryTier })}</dd>
        <dt>{t('collection.detail.obtainedAt')}</dt>
        <dd>{formatDate(entry.obtainedAt, locale)}</dd>
      </dl>
    </div>
  );
}
