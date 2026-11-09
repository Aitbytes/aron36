import { describe, expect, it } from 'vitest';

import {
  QUESTION_CATALOG,
  QUESTION_ITEMS,
  getQuestionById,
  significantKeywordWords,
} from '@/domain/questions';

/**
 * Régression des libellés français.
 *
 * Ces 36 phrases sont apprises **par cœur** : elles ne peuvent pas changer par
 * inadvertance. Toute modification d’un libellé doit être explicite, justifiée
 * et accompagnée d’une mise à jour de ce fichier — donc assumée en revue.
 *
 * Elles ont été produites par revue éditoriale outillée contre le texte anglais
 * publié (voir `TRANSLATION_PROVENANCE`), pas par une relecture humaine : ce
 * tableau fige un état de travail, il ne certifie pas une conformité définitive.
 */
const EXPECTED_FRENCH_PROMPTS: readonly string[] = [
  // Acte I
  'Si tu pouvais choisir n’importe qui dans le monde, qui voudrais-tu avoir comme invité à dîner ?',
  'Aimerais-tu être célèbre ? De quelle manière ?',
  'Avant de passer un appel téléphonique, t’arrive-t-il de répéter ce que tu vas dire ? Pourquoi ?',
  'À quoi ressemblerait pour toi une journée « parfaite » ?',
  'À quand remonte la dernière fois que tu as chanté pour toi-même ? Et pour quelqu’un d’autre ?',
  'Si tu pouvais vivre jusqu’à 90 ans en gardant, pour les 60 dernières années de ta vie, soit l’esprit soit le corps d’une personne de 30 ans, lequel choisirais-tu ?',
  'As-tu une intuition secrète sur la façon dont tu vas mourir ?',
  'Cite trois choses que ton partenaire et toi semblez avoir en commun.',
  'Qu’est-ce qui, dans ta vie, t’inspire le plus de gratitude ?',
  'Si tu pouvais changer quelque chose à la façon dont tu as été élevé·e, que changerais-tu ?',
  'Prends quatre minutes et raconte ta vie à ton partenaire, avec le plus de détails possible.',
  'Si tu pouvais te réveiller demain matin en ayant acquis une qualité ou une capacité, laquelle choisirais-tu ?',
  // Acte II
  'Si une boule de cristal pouvait te dire la vérité sur toi-même, sur ta vie, sur l’avenir ou sur n’importe quoi d’autre, que voudrais-tu savoir ?',
  'Y a-t-il quelque chose que tu rêves de faire depuis longtemps ? Pourquoi ne l’as-tu pas encore fait ?',
  'Quelle est la plus grande réussite de ta vie ?',
  'Qu’est-ce que tu apprécies le plus dans une amitié ?',
  'Quel souvenir t’est le plus précieux ?',
  'Quel est ton souvenir le plus terrible ?',
  'Si tu apprenais que tu mourrais subitement dans un an, changerais-tu quelque chose à ta façon de vivre aujourd’hui ? Pourquoi ?',
  'Que signifie l’amitié pour toi ?',
  'Quelle place l’amour et l’affection tiennent-ils dans ta vie ?',
  'En alternance, partagez chacun une qualité que vous appréciez chez l’autre — cinq éléments en tout.',
  'Ta famille est-elle proche et chaleureuse ? As-tu l’impression que ton enfance a été plus heureuse que celle de la plupart des gens ?',
  'Comment vis-tu ta relation avec ta mère ?',
  // Acte III
  'Faites chacun trois affirmations vraies commençant par « nous ». Par exemple : « Nous sommes tous les deux dans cette pièce et nous ressentons… ».',
  'Complète cette phrase : « J’aimerais avoir quelqu’un avec qui je pourrais partager… ».',
  'Si tu allais devenir un ami proche de ton partenaire, dis-lui ce qu’il serait important qu’il ou elle sache sur toi.',
  'Dis à ton partenaire ce que tu apprécies chez lui ou chez elle ; cette fois, sois vraiment honnête et dis des choses que tu ne dirais pas à quelqu’un que tu viens de rencontrer.',
  'Raconte à ton partenaire un moment embarrassant de ta vie.',
  'Quand as-tu pleuré pour la dernière fois devant une autre personne ? Et seul·e ?',
  'Dis à ton partenaire quelque chose que tu apprécies déjà chez lui ou chez elle.',
  'Y a-t-il quoi que ce soit de trop sérieux pour qu’on en plaisante ?',
  'Si tu devais mourir ce soir sans pouvoir communiquer avec qui que ce soit, qu’est-ce que tu regretterais le plus de ne pas avoir dit à quelqu’un ? Pourquoi ne l’as-tu pas encore dit ?',
  'Ta maison, avec tout ce que tu possèdes, prend feu. Après avoir sauvé tes proches et tes animaux, tu as le temps de faire un dernier aller-retour sans danger pour sauver un seul objet. Lequel, et pourquoi ?',
  'De tous les membres de ta famille, quelle mort te bouleverserait le plus ? Pourquoi ?',
  'Partage un problème personnel et demande à ton partenaire comment il ou elle s’y prendrait pour le gérer. Demande-lui aussi de te dire ce que tu sembles ressentir face à ce problème.',
];

/** Mots-clés français figés : ce sont les accroches des drills mot→question. */
const EXPECTED_FRENCH_KEYWORDS: readonly string[] = [
  'Dîner',
  'Célébrité',
  'Téléphone',
  'Journée parfaite',
  'Chanson',
  '90 ans',
  'Intuition',
  'Points communs',
  'Gratitude',
  'Éducation familiale',
  '4 minutes',
  'Réveil',
  'Boule de cristal',
  'Rêve',
  'Réussite',
  'Amitié',
  'Précieux',
  'Terrible',
  'Mourir dans un an',
  'Signification',
  'Amour',
  'Qualités du partenaire',
  'Famille',
  'Mère',
  'Nous',
  'Partager',
  'À savoir',
  'Honnête',
  'Honte',
  'Pleurs',
  'Déjà',
  'Blague',
  'Regret',
  'Incendie',
  'Deuil',
  'Conseil',
];

/** Libellé français attendu d’une question, ou échec explicite du test. */
function promptFr(questionId: number): string {
  const question = getQuestionById(QUESTION_CATALOG, questionId);
  if (question === undefined) {
    throw new Error(`Question ${String(questionId)} absente du dataset.`);
  }
  return question.prompt.fr;
}

describe('régression des libellés français', () => {
  it('fige les 36 formulations françaises, dans l’ordre du protocole', () => {
    expect(EXPECTED_FRENCH_PROMPTS).toHaveLength(36);
    expect(QUESTION_ITEMS.map((question) => question.prompt.fr)).toEqual([
      ...EXPECTED_FRENCH_PROMPTS,
    ]);
  });

  it('fige les 36 mots-clés français', () => {
    expect(EXPECTED_FRENCH_KEYWORDS).toHaveLength(36);
    expect(QUESTION_ITEMS.map((question) => question.keyword.fr)).toEqual([
      ...EXPECTED_FRENCH_KEYWORDS,
    ]);
  });
});

describe('questions corrigées (sens et langue)', () => {
  it('Q5 « Chanson » : formulation idiomatique, plus de « pour la dernière fois » empilé', () => {
    expect(promptFr(5)).toBe(
      'À quand remonte la dernière fois que tu as chanté pour toi-même ? Et pour quelqu’un d’autre ?',
    );
  });

  it('Q9 « Gratitude » : formulation idiomatique, sans « Pour quoi… éprouves-tu »', () => {
    expect(promptFr(9)).toBe('Qu’est-ce qui, dans ta vie, t’inspire le plus de gratitude ?');
  });

  it('Q10 « Upbringing » : parle de l’éducation familiale, jamais de la scolarité', () => {
    const text = promptFr(10);
    expect(text).toBe(
      'Si tu pouvais changer quelque chose à la façon dont tu as été élevé·e, que changerais-tu ?',
    );
    expect(text).not.toContain('ton éducation');
    expect(text).toContain('élevé·e');
  });

  it('Q19 « Mourir dans un an » : concordance des temps respectée', () => {
    const text = promptFr(19);
    expect(text).toBe(
      'Si tu apprenais que tu mourrais subitement dans un an, changerais-tu quelque chose à ta façon de vivre aujourd’hui ? Pourquoi ?',
    );
    expect(text).not.toContain('tu vas mourir');
  });

  it('Q27 « À savoir » : « un ami proche », pas « un proche »', () => {
    const text = promptFr(27);
    expect(text).toBe(
      'Si tu allais devenir un ami proche de ton partenaire, dis-lui ce qu’il serait important qu’il ou elle sache sur toi.',
    );
    expect(text).toContain('un ami proche');
  });

  it('Q30 « Pleurs » : épicène, sans redondance « seul, sans personne »', () => {
    const text = promptFr(30);
    expect(text).toBe(
      'Quand as-tu pleuré pour la dernière fois devant une autre personne ? Et seul·e ?',
    );
    expect(text).toContain('seul·e');
    // Le lien avec les pleurs doit rester explicite (l’original est elliptique).
    expect(text).toContain('pleuré');
    expect(text).not.toContain('sans personne');
  });

  it('Q32 « Blague » : le hedge « if anything » survit en français', () => {
    const text = promptFr(32);
    expect(text).toBe('Y a-t-il quoi que ce soit de trop sérieux pour qu’on en plaisante ?');
    // La réponse « rien » doit rester explicitement autorisée.
    expect(text).toContain('quoi que ce soit');
  });

  it('Q16 et Q22 : mots-clés pris dans la question, sans mot lexical commun', () => {
    const sixteenth = getQuestionById(QUESTION_CATALOG, 16);
    const twentySecond = getQuestionById(QUESTION_CATALOG, 22);
    expect(sixteenth?.keyword.fr).toBe('Amitié');
    expect(twentySecond?.keyword.fr).toBe('Qualités du partenaire');
    const left = new Set(significantKeywordWords('Amitié'));
    expect(significantKeywordWords('Qualités du partenaire').some((word) => left.has(word))).toBe(
      false,
    );
  });
});
