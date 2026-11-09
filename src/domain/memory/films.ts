import { QUESTIONS_PER_ACT } from '@/domain/shared/types';
import type { ActId, LocalizedText } from '@/domain/shared/types';

import type { FilmScene, MemoryFilm } from './types';

/**
 * Les trois films mentaux (L6, L7) : une scène visuelle par question, chaînée
 * par une phrase de liaison vers la scène suivante.
 *
 * La dernière scène d'un film porte `transitionToNext: null` : le film se
 * termine, il ne boucle pas. Ce fichier est la **source unique** des images
 * mentales ; `questions/data.ts` les projette dans `QuestionItem.mentalImage`
 * pour qu'une image ne puisse jamais diverger entre le dataset et le film.
 */

interface SceneSeed {
  readonly image: LocalizedText;
  readonly transitionToNext: LocalizedText | null;
}

/**
 * Construit les 12 scènes d'un acte. `questionId` et `order` sont **dérivés**
 * de l'acte et du rang : aucune saisie manuelle ne peut les désynchroniser.
 */
function toScenes(actId: ActId, seeds: readonly SceneSeed[]): readonly FilmScene[] {
  return seeds.map((seed, index) => ({
    order: index + 1,
    questionId: (actId - 1) * QUESTIONS_PER_ACT + index + 1,
    image: seed.image,
    transitionToNext: seed.transitionToNext,
  }));
}

const ACT_I_SCENES: readonly SceneSeed[] = [
  {
    image: {
      fr: 'Une table de banquet immense s’étire à l’infini ; une chaise vide attend ton invité.',
      en: 'An enormous banquet table stretches to infinity; an empty chair waits for your guest.',
    },
    transitionToNext: {
      fr: 'L’invité s’assied et retire ses lunettes noires : tout le monde le reconnaît.',
      en: 'The guest sits down and takes off dark glasses: everyone recognises them.',
    },
  },
  {
    image: {
      fr: 'Des lunettes noires posées sur la nappe, une nuée de flashs autour de la table.',
      en: 'Dark glasses on the tablecloth, a burst of camera flashes around the table.',
    },
    transitionToNext: {
      fr: 'Un téléphone vibre dans sa poche : il répète sa phrase avant de décrocher.',
      en: 'A phone buzzes in their pocket: they rehearse their sentence before answering.',
    },
  },
  {
    image: {
      fr: 'Un combiné serré dans une main moite, des mots répétés devant le miroir.',
      en: 'A handset gripped in a damp hand, words rehearsed in front of the mirror.',
    },
    transitionToNext: {
      fr: 'Le miroir devient une fenêtre : dehors, une journée dorée défile.',
      en: 'The mirror becomes a window: outside, a golden day scrolls by.',
    },
  },
  {
    image: {
      fr: 'Une journée entière en accéléré, du lever au coucher du soleil, tout est doré.',
      en: 'A whole day in fast-forward, from sunrise to sunset, everything golden.',
    },
    transitionToNext: {
      fr: 'Le soleil se couche ; quelqu’un entonne une chanson.',
      en: 'The sun sets; someone starts to sing.',
    },
  },
  {
    image: {
      fr: 'Des convives qui chantent en chœur, un micro imaginaire passe de main en main.',
      en: 'Guests singing in chorus, an imaginary microphone passed hand to hand.',
    },
    transitionToNext: {
      fr: 'Le chœur s’arrête net : le temps saute de soixante ans.',
      en: 'The chorus stops short: time leaps forward sixty years.',
    },
  },
  {
    image: {
      fr: 'Une personne de 90 ans se redresse, un corps de 30 ans apparaît dessous.',
      en: 'A 90-year-old straightens up, a 30-year-old body appears beneath.',
    },
    transitionToNext: {
      fr: 'Elle se penche et te chuchote à l’oreille comment tu vas mourir.',
      en: 'They lean in and whisper in your ear how you will die.',
    },
  },
  {
    image: {
      fr: 'Un souffle froid à ton oreille, un frisson te parcourt.',
      en: 'A cold breath at your ear, a shiver runs down your spine.',
    },
    transitionToNext: {
      fr: 'Le frisson te rapproche de ton voisin : trois fils rouges apparaissent.',
      en: 'The shiver pulls you closer to your neighbour: three red threads appear.',
    },
  },
  {
    image: {
      fr: 'Trois fils rouges relient ta poitrine à celle d’en face.',
      en: 'Three red threads link your chest to the one opposite.',
    },
    transitionToNext: {
      fr: 'Les fils vibrent : tout le monde se lève pour te remercier.',
      en: 'The threads vibrate: everyone rises to thank you.',
    },
  },
  {
    image: {
      fr: 'La table entière debout, des mains tendues vers toi, tes yeux se remplissent.',
      en: 'The whole table standing, hands reaching out to you, your eyes filling.',
    },
    transitionToNext: {
      fr: 'Tes parents surgissent et déroulent ton éducation à l’envers.',
      en: 'Your parents appear and rewind your upbringing.',
    },
  },
  {
    image: {
      fr: 'Tes parents rembobinent ton enfance comme une vieille cassette.',
      en: 'Your parents rewind your childhood like an old cassette.',
    },
    transitionToNext: {
      fr: 'La cassette se casse : un sablier de quatre minutes se retourne.',
      en: 'The cassette snaps: a four-minute hourglass turns over.',
    },
  },
  {
    image: {
      fr: 'Un sablier de quatre minutes s’écoule ; ta vie se raconte à toute vitesse.',
      en: 'A four-minute hourglass runs; your life tells itself at full speed.',
    },
    transitionToNext: {
      fr: 'Le sable s’arrête ; tu te réveilles le lendemain, transformé.',
      en: 'The sand stops; you wake the next morning, transformed.',
    },
  },
  {
    image: {
      fr: 'Tu ouvres les yeux au matin avec un pouvoir neuf dans les mains.',
      en: 'You open your eyes in the morning with a new power in your hands.',
    },
    transitionToNext: null,
  },
];

const ACT_II_SCENES: readonly SceneSeed[] = [
  {
    image: {
      fr: 'Une boule de cristal fume au centre de la table ; la voyante écarte les mains.',
      en: 'A crystal ball smokes at the centre of the table; the fortune teller spreads her hands.',
    },
    transitionToNext: {
      fr: 'Dans la boule, un rêve oublié flotte et s’échappe.',
      en: 'Inside the ball, a forgotten dream floats and escapes.',
    },
  },
  {
    image: {
      fr: 'Un rêve ancien, retenu par un fil, s’envole hors de la boule.',
      en: 'An old dream, held by a thread, flies out of the ball.',
    },
    transitionToNext: {
      fr: 'Le fil se transforme en trophée doré.',
      en: 'The thread turns into a golden trophy.',
    },
  },
  {
    image: {
      fr: 'Un trophée doré tourne dans la boule, gravé de ton nom.',
      en: 'A golden trophy spins in the ball, engraved with your name.',
    },
    transitionToNext: {
      fr: 'Le trophée éclate : deux amis s’y serrent dans les bras.',
      en: 'The trophy bursts: two friends embrace inside it.',
    },
  },
  {
    image: {
      fr: 'Deux amis s’étreignent ; une main reste ouverte entre eux.',
      en: 'Two friends hug; a hand stays open between them.',
    },
    transitionToNext: {
      fr: 'De la poignée s’échappe une photo dorée.',
      en: 'A golden photograph slips from the handshake.',
    },
  },
  {
    image: {
      fr: 'Une photo jaunie flotte, intacte, dans un rayon de lumière.',
      en: 'A faded photo floats, intact, in a shaft of light.',
    },
    transitionToNext: {
      fr: 'La photo s’embrase et noircit.',
      en: 'The photo catches fire and turns black.',
    },
  },
  {
    image: {
      fr: 'La boule devient noire, une fumée âcre monte.',
      en: 'The ball goes black, acrid smoke rises.',
    },
    transitionToNext: {
      fr: 'Dans la fumée s’inscrit : « un an ».',
      en: 'In the smoke a word appears: “one year”.',
    },
  },
  {
    image: {
      fr: 'Un compte à rebours de douze mois s’affiche en lettres de feu.',
      en: 'A twelve-month countdown burns in letters of fire.',
    },
    transitionToNext: {
      fr: 'Le feu s’apaise : le mot AMITIÉ s’écrit en lettres géantes.',
      en: 'The fire calms: the word FRIENDSHIP writes itself in giant letters.',
    },
  },
  {
    image: {
      fr: 'Le mot AMITIÉ s’écrit en lettres géantes au-dessus de la table.',
      en: 'The word FRIENDSHIP writes itself in giant letters above the table.',
    },
    transitionToNext: {
      fr: 'Les lettres fondent et deviennent des cœurs qui battent.',
      en: 'The letters melt into beating hearts.',
    },
  },
  {
    image: {
      fr: 'Des cœurs battent dans la boule et se répondent.',
      en: 'Hearts beat inside the ball and answer each other.',
    },
    transitionToNext: {
      fr: 'Les cœurs se posent sur cinq doigts levés.',
      en: 'The hearts land on five raised fingers.',
    },
  },
  {
    image: {
      fr: 'Cinq doigts levés, chacun porte une qualité écrite.',
      en: 'Five raised fingers, each carrying a written quality.',
    },
    transitionToNext: {
      fr: 'Les cinq doigts se referment autour d’un feu de cheminée.',
      en: 'The five fingers close around a fireplace.',
    },
  },
  {
    image: {
      fr: 'Toute ta famille serrée autour d’un feu chaleureux.',
      en: 'Your whole family gathered around a warm fire.',
    },
    transitionToNext: {
      fr: 'Du feu se détache une silhouette : ta mère.',
      en: 'A silhouette steps out of the fire: your mother.',
    },
  },
  {
    image: {
      fr: 'Ta mère s’avance seule vers toi, un regard qui hésite.',
      en: 'Your mother walks alone toward you, her gaze hesitating.',
    },
    transitionToNext: null,
  },
];

const ACT_III_SCENES: readonly SceneSeed[] = [
  {
    image: {
      fr: 'Deux silhouettes face aux flammes disent ensemble : « NOUS… ».',
      en: 'Two silhouettes facing the flames say together: “WE…”',
    },
    transitionToNext: {
      fr: 'Le mot NOUS se détache et roule comme une braise.',
      en: 'The word WE detaches and rolls like an ember.',
    },
  },
  {
    image: {
      fr: 'Une braise dessine une phrase à compléter : « … avec qui partager ».',
      en: 'An ember draws a sentence to complete: “… with whom to share”.',
    },
    transitionToNext: {
      fr: 'La phrase devient une clé qu’on te tend.',
      en: 'The sentence becomes a key handed to you.',
    },
  },
  {
    image: {
      fr: 'On te tend une clé lourde : ce que l’autre doit savoir de toi.',
      en: 'A heavy key is handed to you: what the other must know about you.',
    },
    transitionToNext: {
      fr: 'La clé ouvre une porte, une vérité brute en sort.',
      en: 'The key opens a door, a raw truth comes out.',
    },
  },
  {
    image: {
      fr: 'Une porte s’ouvre sur des mots jamais dits à un inconnu.',
      en: 'A door opens onto words never said to a stranger.',
    },
    transitionToNext: {
      fr: 'Un souvenir gênant rejoue en boucle, en rouge.',
      en: 'An embarrassing memory replays on a loop, in red.',
    },
  },
  {
    image: {
      fr: 'Un moment gênant rejoue en boucle, tes joues rougissent.',
      en: 'An embarrassing moment replays on a loop, your cheeks flush.',
    },
    transitionToNext: {
      fr: 'Tes larmes éteignent la boucle.',
      en: 'Your tears put out the loop.',
    },
  },
  {
    image: {
      fr: 'Des larmes tombent, d’abord devant un visage, puis devant le vide.',
      en: 'Tears fall, first in front of a face, then in front of nothing.',
    },
    transitionToNext: {
      fr: 'Les larmes laissent une trace brillante : ce que tu aimes déjà.',
      en: 'The tears leave a shining trail: what you already like.',
    },
  },
  {
    image: {
      fr: 'Une trace lumineuse dessine ce que tu apprécies déjà chez l’autre.',
      en: 'A glowing trail draws what you already appreciate in the other.',
    },
    transitionToNext: {
      fr: 'La trace mène à un clown, puis à un panneau STOP.',
      en: 'The trail leads to a clown, then to a STOP sign.',
    },
  },
  {
    image: {
      fr: 'Un clown s’avance ; une main se lève : « trop sérieux ».',
      en: 'A clown steps forward; a hand rises: “too serious”.',
    },
    transitionToNext: {
      fr: 'Le STOP devient minuit, dernière occasion de parler.',
      en: 'The STOP becomes midnight, the last chance to speak.',
    },
  },
  {
    image: {
      fr: 'Une horloge sonne minuit ; une phrase reste bloquée dans ta gorge.',
      en: 'A clock strikes midnight; a sentence stays stuck in your throat.',
    },
    transitionToNext: {
      fr: 'Minuit met le feu à la maison.',
      en: 'Midnight sets the house on fire.',
    },
  },
  {
    image: {
      fr: 'La maison brûle ; tes proches sauvés, tu plonges pour un seul objet.',
      en: 'The house burns; loved ones safe, you dive for one single object.',
    },
    transitionToNext: {
      fr: 'L’objet se dissout et devient un cercueil de fumée.',
      en: 'The object dissolves into a coffin of smoke.',
    },
  },
  {
    image: {
      fr: 'Dans la fumée se dessine le visage d’un proche.',
      en: 'A loved one’s face forms in the smoke.',
    },
    transitionToNext: {
      fr: 'La fumée retombe : il ne reste que des cendres et un problème à confier.',
      en: 'The smoke settles: only ashes remain, and a problem to confide.',
    },
  },
  {
    image: {
      fr: 'Assis dans les cendres, tu exposes ton problème ; l’autre écoute.',
      en: 'Sitting in the ashes, you lay out your problem; the other listens.',
    },
    transitionToNext: null,
  },
];

const FILM_ACT_I: MemoryFilm = {
  actId: 1,
  title: { fr: 'Le Dîner', en: 'The Dinner' },
  pitch: {
    fr: 'Tu donnes un dîner ; au fil du repas, la soirée passe du rire à la tendresse puis au vertige.',
    en: 'You are hosting a dinner party; over the meal, the evening drifts from laughter to tenderness and then to vertigo.',
  },
  scenes: toScenes(1, ACT_I_SCENES),
};

const FILM_ACT_II: MemoryFilm = {
  actId: 2,
  title: { fr: 'La Boule de cristal', en: 'The Crystal Ball' },
  pitch: {
    fr: 'Une voyante pose une boule fumante sur la table ; ton passé, tes valeurs et ton avenir défilent dans le verre.',
    en: 'A fortune teller sets a smoking ball on the table; your past, your values and your future scroll by in the glass.',
  },
  scenes: toScenes(2, ACT_II_SCENES),
};

const FILM_ACT_III: MemoryFilm = {
  actId: 3,
  title: { fr: 'L’Incendie', en: 'The Fire' },
  pitch: {
    fr: 'La nuit tombe et la maison s’embrase ; au milieu des flammes, chacun dit enfin ce qui n’avait jamais été dit.',
    en: 'Night falls and the house ignites; amid the flames, everyone finally says what was never said.',
  },
  scenes: toScenes(3, ACT_III_SCENES),
};

const FILMS_BY_ACT = {
  1: FILM_ACT_I,
  2: FILM_ACT_II,
  3: FILM_ACT_III,
} as const satisfies Readonly<Record<ActId, MemoryFilm>>;

/** Les trois films mentaux, dans l’ordre des actes. */
export const MENTAL_FILMS = [
  FILM_ACT_I,
  FILM_ACT_II,
  FILM_ACT_III,
] as const satisfies readonly MemoryFilm[];

/** Film mental d’un acte. Toujours défini : les trois actes du protocole en ont un. */
export function filmForAct(actId: ActId): MemoryFilm {
  return FILMS_BY_ACT[actId];
}

/**
 * Scène `positionInAct` (1..12) du film de l’acte.
 * Renvoie `undefined` hors bornes, sans lever d’exception.
 */
export function filmSceneFor(actId: ActId, positionInAct: number): FilmScene | undefined {
  return FILMS_BY_ACT[actId].scenes[positionInAct - 1];
}
