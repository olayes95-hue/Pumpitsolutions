# Plan commercial & opérationnel — brouillon de travail

*Faire de l'outil de gestion de station un produit vendable à d'autres stations, sans perturber la production actuelle (Beaurivage, Vedoko).*

**Statut** : Brouillon v1 — à valider ensemble.
**Portée** : commercial + opérationnel. Le chantier technique (fondation multi-tenant) est traité séparément, sur un environnement à part, sans impact sur la prod actuelle.

Version mise en forme (lecture recommandée) : voir l'artifact publié en session.

---

## 1. Synthèse

Le produit tourne déjà en production sur deux stations réelles — rare pour un premier client SaaS : la plupart des fondateurs vendent une promesse, ici on peut montrer un tableau de bord qui a déjà détecté de vraies pertes de livraison et de vrais écarts de caisse.

Ambition : **croissance rapide**, exécution **solo** pour l'instant, sur **deux canaux** (démarchage direct + partenariat compagnie pétrolière). Conséquence directe : un solo qui veut scaler vite ne peut pas vendre station par station en priorité — le canal partenariat doit passer devant.

## 2. Proposition de valeur

Ce que l'outil remplace : un suivi papier/WhatsApp de la caisse, des ventes et des commandes — avec les angles morts que ça implique (versements jamais arrivés en banque, écarts de compteur non détectés, pertes de livraison invisibles).

Ordre de vente recommandé :
1. Voir sa caisse en temps réel (stock cuve, bons en cours, écart de versement).
2. Être alerté avant que ça devienne un problème (anti-coulage, écart compteur, perte livraison hors seuil).
3. Ne plus dépendre de la mémoire du gérant (historique, photos-preuves, journal d'audit).

**Angle de vente recommandé** : ne pas vendre « un logiciel de gestion » mais « je détecte les fuites d'argent dans ta station » — avec des exemples réels de ta propre exploitation.

## 3. Marché cible

Profil type : station-service multi-pôles (carburant + gaz + lubrifiant + souvent supérette), gérée à distance par un propriétaire non présent au quotidien, avec un gérant salarié en première ligne — configuration à risque de fuite élevé, donc valeur perçue forte.

Démarrer au Bénin ; chaque nouveau marché (Afrique de l'Ouest francophone) ajoute de la complexité (devise, taxation, paiement) à absorber une fois la version multi-tenant stable.

## 4. Canaux de distribution

| Canal | Effort par client gagné | Vitesse d'accès à beaucoup de stations | Dépendance |
|---|---|---|---|
| Partenariat compagnie pétrolière | Élevé une fois, puis nul | Un contrat → tout un réseau | Forte — un refus ferme le canal |
| Démarchage direct | Constant, par station | Lente, un par un | Faible — chaque client est indépendant |

**Recommandation** : prioriser le partenariat, précisément parce que l'exécution est solo et l'ambition rapide — seul canal capable d'un saut de clients sans saut proportionnel de temps. Mener 2-3 conversations directes en parallèle sert à affiner prix et discours, pas à remplacer le partenariat.

Risque du tout-partenariat : dépendance à un seul acteur, cycle de décision plus long. D'où l'intérêt de ne pas abandonner le direct.

## 5. Modèle de prix

Trois paliers, montants arrêtés (2026-08-12) — **à confronter aux 3-5 premières conversations clients réelles**, ajustables après. Logique : écart modéré Essentiel→Pro (×1,6), écart plus large Pro→Complet (×1,75) car ce dernier vise un public différent (multi-stations, structure organisée) avec une capacité budgétaire plus large. Le palier du milieu (Pro) est celui mis en avant — effet d'ancrage classique (« stratégie McDo ») : un Complet nettement plus cher rend Pro évident sans paraître décoratif, puisque Complet reste un produit crédible pour un vrai acheteur (pas un leurre pur).

**Essentiel — 25 000 F/mois**
- Saisie quotidienne (gérant, vendeuse, pompiste)
- Stock temps réel & autonomie
- Commandes & réceptions
- Écart de caisse & versement manquant (alertes les moins coûteuses à produire)
- Historique des points

**Pro — 40 000 F/mois** ⭐ palier recommandé — tout l'Essentiel, plus :
- Alertes anti-fraude complètes (anti-coulage cuve, écart compteur)
- Prévision de commande

**Complet — 70 000 F/mois** — tout Pro, plus :
- Point financier & rapprochement bancaire
- Vérification OCR des bordereaux
- Export & audit complet
- Idéal multi-stations ; sert aussi de base de négociation pour un tarif partenariat volume (compagnie pétrolière)

Point clé qui corrige une version précédente du plan : même le palier Essentiel délivre une partie de la promesse de vente (« je détecte les fuites d'argent ») via les alertes caisse/versement — plus de palier bas qui ne tient pas le discours commercial. Le partenariat compagnie pétrolière négocie un tarif volume séparé, ancré sur Complet, pas cette grille publique.

## 6. Feuille de route commerciale

| Horizon | Étape | Objectif |
|---|---|---|
| Semaines 1-2 | Valider le prix | 3-5 conversations propriétaires de station — tester la fourchette, pas juste la présenter |
| Semaines 2-4 | Identifier le partenaire pilote | Lister les compagnies pétrolières accessibles, préparer une démo basée sur les vraies données |
| Semaines 3-6 | Fondation technique (en parallèle) | Chantier multi-tenant sur environnement séparé — ne bloque pas la prospection |
| Mois 2-3 | Premier client hors Beaurivage | Valider l'onboarding réel, pas juste la démo |
| Mois 3-6 | Signer le partenariat | Déploiement progressif sur le réseau du partenaire |

## 7. Organisation & ressources

Solo aujourd'hui, mais « croissance rapide + partenariat qui marche » crée un point de bascule prévisible : le support (onboarding, questions gérants, incidents) ne tiendra pas sur une seule personne en plus de la vente une fois le volume monté.

- Premier recrutement probable = **support/onboarding**, avant un deuxième commercial.
- Documenter dès maintenant ce qui se fait « de tête » (réponses aux gérants, configuration d'une station) → futur manuel de formation.

## 8. Outils opérationnels à mettre en place

- **Suivi commercial** — même léger (tableur structuré) : qui a été contacté, où en est la conversation.
- **Support client** — WhatsApp Business, canal le plus naturel dans ce contexte, plutôt qu'un système de tickets occidental.
- **Facturation** — Mobile Money (MTN/Moov) comme moyen de paiement principal.
- **Démo** — environnement séparé de la prod réelle, données d'exemple crédibles (pas les vraies données Beaurivage).

## 9. Légal & conformité

À sécuriser avant le premier client externe :
- **Conditions générales** — propriété des données, sort des données à la résiliation, garanties de disponibilité.
- **Structure juridique** — la société qui facturera est-elle celle de la station, ou une entité séparée ? Impact sur la responsabilité en cas de litige.
- **Confidentialité entre clients** — devoir explicite, et vérifié techniquement (pas juste promis), qu'un client ne voit jamais les données d'un autre.

*Un premier jet de CGU peut être rédigé, mais doit être relu par un juriste habilité au Bénin avant présentation à un vrai client — ceci n'est pas un conseil juridique.*

## 10. Financement

Tension à trancher : la croissance rapide a un coût (développement, recrutement, prospection) que les revenus des premiers clients ne couvriront pas immédiatement.

Option A : scaler sur les revenus de la station actuelle en attendant les premiers abonnements externes.
Option B : chercher un financement externe pour aller plus vite dès le départ.

Un partenariat compagnie pétrolière abouti peut lui-même devenir l'argument principal pour lever des fonds ensuite, plutôt que l'inverse.

## 11. Décisions qui appartiennent à l'utilisateur

- ~~Prix des paliers~~ — tranché (§5) : 25 000 / 40 000 / 70 000 F, à confronter aux premières conversations réelles.
- Compagnie(s) pétrolière(s) à approcher en premier, et qui porte la relation.
- Structure juridique de facturation (société existante ou nouvelle entité).
- Financement : bootstrap sur revenus actuels, ou capital externe.
