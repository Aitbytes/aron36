# Aron 36 — Apprendre par cœur les 36 questions d'Aron

Appli web statique (fichier unique, zéro dépendance) qui regroupe tout le kit
d'apprentissage basé sur la science de la mémorisation :

- **Les 36 questions** (Aron et al., 1997) classées en 3 actes, avec mode récitation (rappel à froid)
- **Les 3 films mentaux** (link method / chaînes d'images)
- **Le plan 7 jours** avec cases à cocher persistantes
- **L'entraînement** : apprentissage par acte avec indices, révision espacée (boîtes de Leitner), QCM croisé
- **La progression** : histogramme des boîtes, cartes solides, prochaines échéances

La progression est stockée dans le `localStorage` du navigateur.

## Techniques mobilisées (preuves)

| Technique | Référence |
|---|---|
| Testing effect (rappel actif) | Roediger & Karpicke, 2006 |
| Répétition espacée | Ebbinghaus ; Cepeda et al., 2006 ; Dunlosky et al., 2013 |
| Chunking (3×12) | Miller, 1956 |
| Chaînes d'images / palais mental | Maguire et al., 2003 |
| Production effect (à voix haute) | MacLeod, 2010 |
| Consolidation pendant le sommeil | Rasch & Born, 2013 |

## Déploiement

Statique : n'importe quel serveur de fichiers. Déployé sur Dokploy (build type `static`).

## Développement

Ouvrir `index.html` dans un navigateur. C'est tout.
