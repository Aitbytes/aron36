/**
 * Catalogue de messages français — **source de vérité des clés** (ADR 0005).
 *
 * Ce fichier ne doit contenir **aucun** texte destiné aux questions : le contenu
 * des 36 questions vit dans le dataset (`LocalizedText`). Ici, uniquement
 * l'interface.
 *
 * Conventions :
 * - clés plates en `dot.case`, jamais imbriquées : `MessageKey` reste une union
 *   de chaînes littérales, donc une clé absente ou en trop casse `tsc` ;
 * - pluriel simple : la clé de base sert de forme neutre, `_one` et `_other`
 *   sont choisies par `createTranslator` selon `params.count` ;
 * - aucun texte visible n'est écrit ailleurs que dans un catalogue.
 */
export const frMessages = {
  // ── Application ─────────────────────────────────────────────────────────
  'app.name': 'Aron 36',
  'app.skipToContent': 'Aller au contenu',

  // ── Navigation ──────────────────────────────────────────────────────────
  'nav.label': 'Navigation principale',
  'nav.home': 'Accueil',
  'nav.train': 'Entraînement',
  'nav.collection': 'Collection',
  'nav.stats': 'Statistiques',
  'nav.settings': 'Réglages',

  // ── Coque (en-tête, niveaux, séries) ────────────────────────────────────
  'shell.level': 'Niveau {level}',
  'shell.xpTotal': 'XP totale : {xp}',
  'shell.xpInLevel': '{current} / {span} XP dans ce niveau',
  'shell.maxLevel': 'Niveau maximal atteint',
  'shell.streak': 'Série de {count} jours',
  'shell.streak_one': 'Série de {count} jour',
  'shell.streak_other': 'Série de {count} jours',
  'shell.freezes': 'Gels disponibles : {count}',
  'shell.openSettings': 'Ouvrir les réglages',
  'shell.loading': 'Chargement de votre progression…',
  'shell.busy': 'Opération en cours',

  // ── Accueil ─────────────────────────────────────────────────────────────
  'home.title': 'Accueil',
  'home.heroTitle': 'Entraînement du jour',
  'home.heroLead': 'Rappel actif uniquement : aucun texte à relire avant de produire.',
  'home.startSession': 'Commencer la session',
  'home.dueCount': '{count} cartes à réviser',
  'home.dueCount_one': '{count} carte à réviser',
  'home.dueCount_other': '{count} cartes à réviser',
  'home.dueNone': 'Aucune carte due : une session d’apprentissage est proposée.',
  'home.questsTitle': 'Quêtes du jour',
  'home.questsEmpty': 'Les quêtes du jour apparaissent à la première réponse de la journée.',
  'home.questProgress': '{current} / {target}',
  'home.questDone': 'Terminée',
  'home.nextActTitle': 'Prochain acte à débloquer',
  'home.nextActAllUnlocked': 'Les trois actes sont débloqués.',
  'home.nextActRequirement': '{act} se débloque quand {previous} atteint {ratio} % de maîtrise.',
  'home.nextActProgress': '{mastered} / {total} questions maîtrisées',
  'home.progressTitle': 'Progression du niveau',
  'home.actLabel': 'Acte {act}',

  // ── Récupération de données ─────────────────────────────────────────────
  'recovery.title': 'Progression protégée',
  'recovery.protected': 'Vos données n’ont pas été écrasées : rien n’a été écrit.',
  'recovery.updateApp':
    'Cette progression vient d’une version plus récente de l’application. Mettez l’application à jour, puis rechargez la page.',
  'recovery.retryLater':
    'Le stockage local est momentanément indisponible. Vos données sont intactes : réessayez plus tard.',
  'recovery.rescue': 'Vous pouvez importer une sauvegarde JSON ou repartir d’un profil neuf.',
  'recovery.import': 'Importer une sauvegarde',
  'recovery.reset': 'Réinitialiser la progression',
  'recovery.resetTitle': 'Réinitialiser la progression ?',
  'recovery.resetBody':
    'Toute la progression locale sera remplacée par un profil neuf. Cette action est définitive.',
  'recovery.resetContinue': 'Continuer',
  'recovery.resetSecondStep':
    'Dernière confirmation : les données actuelles seront définitivement perdues.',
  'recovery.resetConfirm': 'Confirmer la réinitialisation',
  'recovery.cancel': 'Annuler',
  'recovery.close': 'Fermer',
  'recovery.details': 'Détail technique : {code}',
  'recovery.code.invalidJson': 'Le contenu enregistré n’est pas un JSON valide.',
  'recovery.code.invalidShape': 'Le contenu enregistré ne correspond pas au format attendu.',
  'recovery.code.unsupportedVersion': 'Le format enregistré est trop ancien pour cette version.',
  'recovery.code.missingMigration': 'Une migration manque pour lire cette version.',
  'recovery.code.futureVersion': 'Le format enregistré vient d’une version plus récente.',
  'recovery.code.readFailed': 'La lecture du stockage local a échoué.',
  'recovery.code.writeFailed': 'L’écriture dans le stockage local a échoué.',
  'recovery.code.quotaExceeded': 'Le stockage local est plein.',
  'recovery.code.storageUnavailable': 'Le stockage local est indisponible.',

  // ── Actions et échecs ───────────────────────────────────────────────────
  'action.failure.unknown': 'Action impossible pour le moment.',
  'action.failure.unknownSession': 'Aucune session active pour cette action.',
  'action.failure.transitionRefused': 'Cette transition n’est pas possible maintenant.',
  'action.failure.submissionRefused': 'La réponse a été refusée par le moteur de session.',
  'action.failure.buildRefused': 'Aucune session ne peut être construite avec ces critères.',
  'action.failure.hookRefused': 'Cette accroche ne peut pas être enregistrée.',
  'action.failure.hintUnavailable': 'Aucun indice n’est disponible pour cet item.',
  'action.failure.progressUnavailable':
    'La progression est indisponible : passez par la récupération de données.',
  'action.failure.progressProtected':
    'Progression d’une version plus récente : aucune écriture n’est autorisée.',
  'action.failure.importFailed': 'Le fichier de sauvegarde est illisible.',
  'action.failure.exportFailed': 'L’export de la sauvegarde a échoué.',
  'action.failure.resetFailed': 'La réinitialisation a échoué.',

  // ── Notifications ───────────────────────────────────────────────────────
  'toast.regionLabel': 'Notifications',
  'toast.dismiss': 'Fermer la notification',
  'toast.writeFailed.title': 'Sauvegarde impossible',
  'toast.writeFailed.body':
    'Votre progression reste valable dans cette session (code {code}). Pensez à exporter une sauvegarde.',
  'toast.importDone.title': 'Sauvegarde importée',
  'toast.importDone.body': 'Votre progression a été remplacée par la sauvegarde.',
  'toast.importFailed.title': 'Import impossible',
  'toast.importFailed.body': 'Le fichier choisi n’a pas pu être lu (code {code}).',
  'toast.resetDone.title': 'Progression réinitialisée',
  'toast.resetDone.body': 'Un profil neuf a été créé.',

  // ── Écrans (coquilles assumées) ─────────────────────────────────────────
  'screen.underConstruction': 'En construction',
  'screen.comingSoon': 'Cet écran arrive dans un lot suivant.',
  'train.title': 'Entraînement',
  'train.description':
    'L’écran de jeu arrivera ici : cinq directions de drill, indices progressifs, jugement de confiance et feedback correctif.',
  'collection.title': 'Collection',
  'collection.description':
    'Les 36 cartes de collection s’afficheront ici, avec leur palier de maîtrise.',
  'stats.title': 'Statistiques',
  'stats.description':
    'Les métriques dérivées (précision par direction, calibration, sessions) s’afficheront ici.',
  'settings.title': 'Réglages',
  'settings.description':
    'La langue, la synthèse vocale, l’objectif quotidien et le mouvement réduit se règlent ici.',

  // ── Primitives ──────────────────────────────────────────────────────────
  'primitive.spinner.label': 'Chargement en cours',
} as const;

/** Clé de message valide : toute clé absente du catalogue français casse `tsc`. */
export type MessageKey = keyof typeof frMessages;
