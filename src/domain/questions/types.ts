import type { MemoryFilm } from '@/domain/memory/types';
import type { ActId, LocalizedText, PositionInAct, QuestionId, Ratio } from '@/domain/shared/types';

/**
 * Contenu du protocole : les 36 questions, leurs mots-clés et leurs images.
 *
 * Invariants (vérifiés par `questions/catalog.test.ts` en Phase 2) :
 * - exactement 36 questions, identifiants 1..36 uniques ;
 * - `actId === Math.floor((order - 1) / 12) + 1` ;
 * - `positionInAct === ((order - 1) % 12) + 1`, donc 1..12 ;
 * - en v1, `id === order` (l'identifiant stable suit l'ordre du protocole) ;
 * - `keyword.fr`, `prompt.fr` et `mentalImage.fr` sont non vides ;
 * - chaque acte contient exactement 12 questions et un film mental de 12 scènes.
 */
export interface QuestionItem {
  /** Identifiant global stable, 1..36. */
  readonly id: QuestionId;
  /** Acte d'appartenance, déduit de `order`. */
  readonly actId: ActId;
  /** Rang global dans le protocole, 1..36. */
  readonly order: number;
  /** Rang dans l'acte, 1..12. */
  readonly positionInAct: PositionInAct;
  /** Mot-clé d'accroche, unique au sein d'un acte. */
  readonly keyword: LocalizedText;
  /** Formulation complète de la question, telle qu'elle doit être restituée. */
  readonly prompt: LocalizedText;
  /** Image mentale associée (double codage, L6). */
  readonly mentalImage: LocalizedText;
  /** Thèmes libres utilisés pour l'entrelacement éditorial (ex. « famille »). */
  readonly themeTags: readonly string[];
}

/** Un acte du protocole, avec son film mental. */
export interface Act {
  readonly id: ActId;
  /** Ordre de passation : 1, 2 puis 3. */
  readonly order: number;
  /** Titre affiché, ex. « Acte I — Briser la glace ». */
  readonly title: LocalizedText;
  /** Le film mental qui chaîne les 12 images de l'acte (L7). */
  readonly film: MemoryFilm;
}

/** Catalogue indexé, construit une seule fois au démarrage. */
export interface QuestionCatalog {
  readonly questions: readonly QuestionItem[];
  readonly acts: readonly Act[];
  /** Index par identifiant ; toute question 1..36 doit y être présente. */
  readonly byId: ReadonlyMap<QuestionId, QuestionItem>;
  /** Index inverse mot-clé normalisé → question, pour les drills et les leurres. */
  readonly byKeyword: ReadonlyMap<string, QuestionItem>;
}

/**
 * État de la relecture humaine. Un booléen `true` auto-déclaré ne prouve rien :
 * l'état doit rester explicite et vérifiable.
 */
export type TranslationReviewStatus = 'pending' | 'in-progress' | 'done';

/**
 * Provenance **honnête** de la traduction française.
 *
 * Elle décrit ce qui a réellement été fait (méthode, source anglaise de
 * comparaison, tests de régression) et ce qui reste à faire (relecture humaine
 * native). Tant que `humanReview` vaut `pending`, aucun test ni écran ne peut
 * présenter le français comme vérifié par un humain.
 */
export interface TranslationProvenance {
  /** Procédé réellement appliqué pour produire et contrôler le français. */
  readonly method: string;
  /** Texte anglais de référence, jamais réinventé (source publiée). */
  readonly englishSource: string;
  /** État réel de la relecture humaine, sans auto-déclaration possible. */
  readonly humanReview: TranslationReviewStatus;
  /** Date ISO 8601 de la relecture humaine, `null` tant qu'elle n'a pas eu lieu. */
  readonly reviewedAt: string | null;
  /** Ce qui reste à faire, énoncé sans ambiguïté. */
  readonly outstandingReview: string;
}

/** Provenance et état de validation du contenu. */
export interface DatasetMetadata {
  /** Citation bibliographique complète (Aron et al., 1997). */
  readonly sourceCitation: string;
  /**
   * Provenance de la traduction française. Remplace l'ancien booléen
   * `frenchTranslationVerified`, qui certifiait une vérification humaine
   * inexistante sans qu'aucun test ne puisse le contredire.
   */
  readonly translationProvenance: TranslationProvenance;
  /** Version sémantique du contenu (`1.0.0`), incrémentée à chaque correction. */
  readonly contentVersion: string;
  /** Ratio de questions dont les champs `fr` sont non vides (attendu : 1). */
  readonly frenchCompleteness: Ratio;
}

/** Dataset complet livré par la Phase 2. */
export interface QuestionDataset {
  readonly catalog: QuestionCatalog;
  readonly metadata: DatasetMetadata;
}
