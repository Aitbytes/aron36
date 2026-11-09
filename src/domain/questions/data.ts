import { filmForAct } from '@/domain/memory/films';
import type { ActId, LocalizedText, Ratio } from '@/domain/shared/types';
import { QUESTIONS_PER_ACT } from '@/domain/shared/types';

import type { DatasetMetadata, QuestionItem } from './types';

/**
 * Dataset des 36 questions d’Aron et al. (1997), en trois actes de 12.
 *
 * **Anglais = source de vérité.** Le texte `prompt.en` reproduit la formulation
 * canonique publiée dans l’article original ; le texte `prompt.fr` en est une
 * traduction naturelle et fidèle, corrigée en Phase 2 contre cet original (la
 * version v0 de `docs/legacy/questions-fr.json` contenait des contresens et des
 * fragments non interrogatifs — voir la PR `feat/p2a-dataset`).
 *
 * Les images mentales ne sont **pas** écrites ici : elles appartiennent aux
 * films (`memory/films.ts`) et sont projetées dans `QuestionItem.mentalImage`
 * par `toItems`. La « référence à la scène » d’une question est son couple
 * (`actId`, `positionInAct`), qui coïncide toujours avec `FilmScene.order`.
 */

/** Citation bibliographique de la source du protocole. */
export const SOURCE_CITATION =
  'Aron, A., Melinat, E., Aron, E. N., Vallone, R. D., & Bator, R. J. (1997). ' +
  'The Experimental Generation of Interpersonal Closeness: A Procedure and Some ' +
  'Preliminary Findings. Personality and Social Psychology Bulletin, 23(4), 363–377.';

/** Version sémantique du contenu : incrémentée à chaque correction éditoriale. */
export const CONTENT_VERSION = '1.0.0';

/**
 * `true` : la traduction française a été vérifiée ligne à ligne contre le texte
 * anglais publié pendant la Phase 2. Un contresens restant doit faire retomber
 * ce drapeau à `false` et incrémenter `CONTENT_VERSION`.
 */
export const FRENCH_TRANSLATION_VERIFIED = true;

/** Contenu éditorial d’un acte, hors film (le film vient de `memory/films.ts`). */
export interface ActContent {
  readonly id: ActId;
  readonly order: number;
  readonly title: LocalizedText;
}

/** Titres des trois actes, dans l’ordre de passation. */
export const ACT_CONTENTS = [
  {
    id: 1,
    order: 1,
    title: { fr: 'Acte I — Briser la glace', en: 'Act I — Breaking the Ice' },
  },
  {
    id: 2,
    order: 2,
    title: { fr: 'Acte II — Valeurs et souvenirs', en: 'Act II — Values and Memories' },
  },
  {
    id: 3,
    order: 3,
    title: { fr: 'Acte III — Vulnérabilité', en: 'Act III — Vulnerability' },
  },
] as const satisfies readonly ActContent[];

interface QuestionSeed {
  readonly keyword: LocalizedText;
  readonly prompt: LocalizedText;
  readonly themeTags: readonly string[];
}

const ACT_I_SEEDS: readonly QuestionSeed[] = [
  {
    keyword: { fr: 'Dîner', en: 'Dinner' },
    prompt: {
      fr: 'Si tu pouvais choisir n’importe qui dans le monde, qui voudrais-tu avoir comme invité à dîner ?',
      en: 'Given the choice of anyone in the world, whom would you want as a dinner guest?',
    },
    themeTags: ['ouverture', 'imaginaire'],
  },
  {
    keyword: { fr: 'Célébrité', en: 'Fame' },
    prompt: {
      fr: 'Aimerais-tu être célèbre ? De quelle manière ?',
      en: 'Would you like to be famous? In what way?',
    },
    themeTags: ['identité', 'reconnaissance'],
  },
  {
    keyword: { fr: 'Téléphone', en: 'Phone call' },
    prompt: {
      fr: 'Avant de passer un appel téléphonique, t’arrive-t-il de répéter ce que tu vas dire ? Pourquoi ?',
      en: 'Before making a telephone call, do you ever rehearse what you are going to say? Why?',
    },
    themeTags: ['communication', 'anticipation'],
  },
  {
    keyword: { fr: 'Journée parfaite', en: 'Perfect day' },
    prompt: {
      fr: 'À quoi ressemblerait pour toi une journée « parfaite » ?',
      en: 'What would constitute a “perfect” day for you?',
    },
    themeTags: ['bonheur', 'quotidien'],
  },
  {
    keyword: { fr: 'Chanson', en: 'Singing' },
    prompt: {
      fr: 'Quand as-tu chanté pour toi-même pour la dernière fois ? Et pour quelqu’un d’autre ?',
      en: 'When did you last sing to yourself? To someone else?',
    },
    themeTags: ['expression', 'musique'],
  },
  {
    keyword: { fr: '90 ans', en: 'Age 90' },
    prompt: {
      fr: 'Si tu pouvais vivre jusqu’à 90 ans en gardant, pour les 60 dernières années de ta vie, soit l’esprit soit le corps d’une personne de 30 ans, lequel choisirais-tu ?',
      en: 'If you were able to live to the age of 90 and retain either the mind or body of a 30-year-old for the last 60 years of your life, which would you want?',
    },
    themeTags: ['corps', 'esprit', 'vieillesse'],
  },
  {
    keyword: { fr: 'Intuition', en: 'Hunch' },
    prompt: {
      fr: 'As-tu une intuition secrète sur la façon dont tu vas mourir ?',
      en: 'Do you have a secret hunch about how you will die?',
    },
    themeTags: ['mort', 'intuition'],
  },
  {
    keyword: { fr: 'Points communs', en: 'In common' },
    prompt: {
      fr: 'Cite trois choses que ton partenaire et toi semblez avoir en commun.',
      en: 'Name three things you and your partner appear to have in common.',
    },
    themeTags: ['lien', 'proximité'],
  },
  {
    keyword: { fr: 'Gratitude', en: 'Gratitude' },
    prompt: {
      fr: 'Pour quoi, dans ta vie, éprouves-tu le plus de gratitude ?',
      en: 'For what in your life do you feel most grateful?',
    },
    themeTags: ['gratitude', 'bonheur'],
  },
  {
    keyword: { fr: 'Éducation', en: 'Upbringing' },
    prompt: {
      fr: 'Si tu pouvais changer quelque chose à ton éducation, que changerais-tu ?',
      en: 'If you could change anything about the way you were raised, what would it be?',
    },
    themeTags: ['enfance', 'famille'],
  },
  {
    keyword: { fr: '4 minutes', en: 'Four minutes' },
    prompt: {
      fr: 'Prends quatre minutes et raconte ta vie à ton partenaire, avec le plus de détails possible.',
      en: 'Take four minutes and tell your partner your life story in as much detail as possible.',
    },
    themeTags: ['récit', 'identité'],
  },
  {
    keyword: { fr: 'Réveil', en: 'Waking up' },
    prompt: {
      fr: 'Si tu pouvais te réveiller demain matin en ayant acquis une qualité ou une capacité, laquelle choisirais-tu ?',
      en: 'If you could wake up tomorrow having gained any one quality or ability, what would it be?',
    },
    themeTags: ['changement', 'capacité'],
  },
];

const ACT_II_SEEDS: readonly QuestionSeed[] = [
  {
    keyword: { fr: 'Boule de cristal', en: 'Crystal ball' },
    prompt: {
      fr: 'Si une boule de cristal pouvait te dire la vérité sur toi-même, sur ta vie, sur l’avenir ou sur n’importe quoi d’autre, que voudrais-tu savoir ?',
      en: 'If a crystal ball could tell you the truth about yourself, your life, the future or anything else, what would you want to know?',
    },
    themeTags: ['avenir', 'vérité'],
  },
  {
    keyword: { fr: 'Rêve', en: 'Long-held dream' },
    prompt: {
      fr: 'Y a-t-il quelque chose que tu rêves de faire depuis longtemps ? Pourquoi ne l’as-tu pas encore fait ?',
      en: 'Is there something that you’ve dreamed of doing for a long time? Why haven’t you done it?',
    },
    themeTags: ['rêve', 'action'],
  },
  {
    keyword: { fr: 'Réussite', en: 'Accomplishment' },
    prompt: {
      fr: 'Quelle est la plus grande réussite de ta vie ?',
      en: 'What is the greatest accomplishment of your life?',
    },
    themeTags: ['réussite', 'fierté'],
  },
  {
    keyword: { fr: 'Qualités d’un ami', en: 'What a friend brings' },
    prompt: {
      fr: 'Qu’est-ce que tu apprécies le plus dans une amitié ?',
      en: 'What do you value most in a friendship?',
    },
    themeTags: ['amitié', 'valeurs'],
  },
  {
    keyword: { fr: 'Souvenir précieux', en: 'Treasured memory' },
    prompt: {
      fr: 'Quel souvenir t’est le plus précieux ?',
      en: 'What is your most treasured memory?',
    },
    themeTags: ['mémoire', 'bonheur'],
  },
  {
    keyword: { fr: 'Pire souvenir', en: 'Worst memory' },
    prompt: {
      fr: 'Quel est ton souvenir le plus terrible ?',
      en: 'What is your most terrible memory?',
    },
    themeTags: ['mémoire', 'souffrance'],
  },
  {
    keyword: { fr: 'Mourir dans un an', en: 'One year to live' },
    prompt: {
      fr: 'Si tu apprenais que tu vas mourir subitement dans un an, changerais-tu quelque chose à ta façon de vivre aujourd’hui ? Pourquoi ?',
      en: 'If you knew that in one year you would die suddenly, would you change anything about the way you are now living? Why?',
    },
    themeTags: ['mort', 'priorités'],
  },
  {
    keyword: { fr: 'Sens de l’amitié', en: 'Meaning of friendship' },
    prompt: {
      fr: 'Que signifie l’amitié pour toi ?',
      en: 'What does friendship mean to you?',
    },
    themeTags: ['amitié', 'sens'],
  },
  {
    keyword: { fr: 'Amour', en: 'Love' },
    prompt: {
      fr: 'Quelle place l’amour et l’affection tiennent-ils dans ta vie ?',
      en: 'What roles do love and affection play in your life?',
    },
    themeTags: ['amour', 'affection'],
  },
  {
    keyword: { fr: 'Cinq qualités', en: 'Five qualities' },
    prompt: {
      fr: 'En alternance, partagez chacun une qualité que vous appréciez chez l’autre — cinq éléments en tout.',
      en: 'Alternate sharing something you consider a positive characteristic of your partner. Share a total of five items.',
    },
    themeTags: ['amitié', 'reconnaissance'],
  },
  {
    keyword: { fr: 'Famille', en: 'Family' },
    prompt: {
      fr: 'Ta famille est-elle proche et chaleureuse ? As-tu l’impression que ton enfance a été plus heureuse que celle de la plupart des gens ?',
      en: 'How close and warm is your family? Do you feel your childhood was happier than most other people’s?',
    },
    themeTags: ['famille', 'enfance'],
  },
  {
    keyword: { fr: 'Mère', en: 'Mother' },
    prompt: {
      fr: 'Comment vis-tu ta relation avec ta mère ?',
      en: 'How do you feel about your relationship with your mother?',
    },
    themeTags: ['famille', 'mère'],
  },
];

const ACT_III_SEEDS: readonly QuestionSeed[] = [
  {
    keyword: { fr: 'Nous', en: 'We statements' },
    prompt: {
      fr: 'Faites chacun trois affirmations vraies commençant par « nous ». Par exemple : « Nous sommes tous les deux dans cette pièce et nous ressentons… ».',
      en: 'Make three true “we” statements each. For instance, “We are both in this room feeling …”.',
    },
    themeTags: ['lien', 'présent'],
  },
  {
    keyword: { fr: 'Partager', en: 'To share' },
    prompt: {
      fr: 'Complète cette phrase : « J’aimerais avoir quelqu’un avec qui je pourrais partager… ».',
      en: 'Complete this sentence: “I wish I had someone with whom I could share …”.',
    },
    themeTags: ['partage', 'manque'],
  },
  {
    keyword: { fr: 'À savoir', en: 'What to know' },
    prompt: {
      fr: 'Si tu allais devenir un proche de ton partenaire, dis-lui ce qu’il serait important qu’il ou elle sache sur toi.',
      en: 'If you were going to become a close friend with your partner, please share what would be important for him or her to know.',
    },
    themeTags: ['confiance', 'identité'],
  },
  {
    keyword: { fr: 'Honnête', en: 'Honesty' },
    prompt: {
      fr: 'Dis à ton partenaire ce que tu apprécies chez lui ou chez elle ; cette fois, sois vraiment honnête et dis des choses que tu ne dirais pas à quelqu’un que tu viens de rencontrer.',
      en: 'Tell your partner what you like about them; be very honest this time, saying things that you might not say to someone you’ve just met.',
    },
    themeTags: ['honnêteté', 'vulnérabilité'],
  },
  {
    keyword: { fr: 'Honte', en: 'Embarrassing moment' },
    prompt: {
      fr: 'Raconte à ton partenaire un moment embarrassant de ta vie.',
      en: 'Share with your partner an embarrassing moment in your life.',
    },
    themeTags: ['honte', 'vulnérabilité'],
  },
  {
    keyword: { fr: 'Pleurs', en: 'Crying' },
    prompt: {
      fr: 'Quand as-tu pleuré pour la dernière fois devant quelqu’un ? Et seul, sans personne ?',
      en: 'When did you last cry in front of another person? By yourself?',
    },
    themeTags: ['émotions', 'vulnérabilité'],
  },
  {
    keyword: { fr: 'Déjà', en: 'Already' },
    prompt: {
      fr: 'Dis à ton partenaire quelque chose que tu apprécies déjà chez lui ou chez elle.',
      en: 'Tell your partner something that you like about them already.',
    },
    themeTags: ['appréciation', 'lien'],
  },
  {
    keyword: { fr: 'Blague', en: 'Joking' },
    prompt: {
      fr: 'Y a-t-il des sujets trop sérieux pour qu’on en plaisante ?',
      en: 'What, if anything, is too serious to be joked about?',
    },
    themeTags: ['humour', 'limites'],
  },
  {
    keyword: { fr: 'Regret', en: 'Unspoken regret' },
    prompt: {
      fr: 'Si tu devais mourir ce soir sans pouvoir communiquer avec qui que ce soit, qu’est-ce que tu regretterais le plus de ne pas avoir dit à quelqu’un ? Pourquoi ne l’as-tu pas encore dit ?',
      en: 'If you were to die this evening with no opportunity to communicate with anyone, what would you most regret not having told someone? Why haven’t you told them yet?',
    },
    themeTags: ['regret', 'mort'],
  },
  {
    keyword: { fr: 'Incendie', en: 'House fire' },
    prompt: {
      fr: 'Ta maison, avec tout ce que tu possèdes, prend feu. Après avoir sauvé tes proches et tes animaux, tu as le temps de faire un dernier aller-retour sans danger pour sauver un seul objet. Lequel, et pourquoi ?',
      en: 'Your house, containing everything you own, catches fire. After saving your loved ones and pets, you have time to safely make a final dash to save any one item. What would it be? Why?',
    },
    themeTags: ['valeurs', 'perte'],
  },
  {
    keyword: { fr: 'Deuil', en: 'Loss' },
    prompt: {
      fr: 'De tous les membres de ta famille, quelle mort te bouleverserait le plus ? Pourquoi ?',
      en: 'Of all the people in your family, whose death would you find most disturbing? Why?',
    },
    themeTags: ['famille', 'deuil'],
  },
  {
    keyword: { fr: 'Conseil', en: 'Personal advice' },
    prompt: {
      fr: 'Partage un problème personnel et demande à ton partenaire comment il ou elle s’y prendrait pour le gérer. Demande-lui aussi de te dire ce que tu sembles ressentir face à ce problème.',
      en: 'Share a personal problem and ask your partner’s advice on how he or she might handle it. Also, ask your partner to reflect back to you how you seem to be feeling about the problem you have chosen.',
    },
    themeTags: ['confiance', 'entraide'],
  },
];

/**
 * Projette les contenus d’un acte en `QuestionItem`. `id`, `actId`, `order` et
 * `positionInAct` sont **dérivés de la position** ; `mentalImage` est repris de
 * la scène correspondante du film de l’acte. Aucune valeur n’est dupliquée à la
 * main, donc aucune ne peut diverger.
 */
function toItems(actId: ActId, seeds: readonly QuestionSeed[]): readonly QuestionItem[] {
  const film = filmForAct(actId);
  return seeds.map((seed, index) => {
    const scene = film.scenes[index];
    if (scene === undefined) {
      // Erreur de programmation : le jeu de données statique est incomplet.
      throw new Error(`Scène ${String(index + 1)} manquante pour l’acte ${String(actId)}.`);
    }
    const positionInAct = index + 1;
    const id = (actId - 1) * QUESTIONS_PER_ACT + positionInAct;
    return {
      id,
      actId,
      order: id,
      positionInAct,
      keyword: seed.keyword,
      prompt: seed.prompt,
      mentalImage: scene.image,
      themeTags: seed.themeTags,
    };
  });
}

/** Les 36 questions, ordonnées de 1 à 36. */
export const QUESTION_ITEMS = [
  ...toItems(1, ACT_I_SEEDS),
  ...toItems(2, ACT_II_SEEDS),
  ...toItems(3, ACT_III_SEEDS),
] as const satisfies readonly QuestionItem[];

/** Complétude française du dataset : part des champs `fr` non vides (attendu : 1). */
export function buildDatasetMetadata(questions: readonly QuestionItem[]): DatasetMetadata {
  const frenchTexts = questions.flatMap((question) => [
    question.keyword.fr,
    question.prompt.fr,
    question.mentalImage.fr,
  ]);
  const total = frenchTexts.length;
  const filled = frenchTexts.filter((text) => text.trim().length > 0).length;
  const frenchCompleteness: Ratio = total === 0 ? 0 : filled / total;
  return {
    sourceCitation: SOURCE_CITATION,
    frenchTranslationVerified: FRENCH_TRANSLATION_VERIFIED,
    contentVersion: CONTENT_VERSION,
    frenchCompleteness,
  };
}
