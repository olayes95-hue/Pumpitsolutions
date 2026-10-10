# Module notifications (Brevo) — déploiement

Comme pour `ocr-bordereau`, l'envoi d'e-mail se fait côté serveur : la clé Brevo ne doit jamais
être dans le navigateur.

## 1. Base de données

Supabase → SQL Editor → lance dans l'ordre :
1. **`supabase/migration_v113_notifications.sql`** (tables de base)
2. **`supabase/migration_v114_notifications_v2.sql`** (catalogue complet de déclencheurs +
   paramétrage par offre — règles créées **inactives**, à relire avant d'activer)
3. **`supabase/migration_v115_notifications_v3.sql`** (compte à valider / accès retiré / client
   suspendu — ajoute `profiles.updated_at` et `organisations.updated_at`)

## 2. Clé Brevo
Crée une clé API sur https://app.brevo.com → SMTP & API → API Keys.

## 3. Secrets + déploiement des fonctions

Chaque fonction est autonome (le gabarit d'e-mail — logo/« Bonjour »/pied de page — est inclus
directement dans chacune, pas de fichier partagé) : déploiement par CLI ou copier-coller dans le
dashboard, les deux marchent.

```bash
supabase secrets set BREVO_API_KEY=xkeysib-xxxxxxxx
supabase secrets set BREVO_SENDER_EMAIL=notifications@pumpit.app
supabase secrets set BREVO_SENDER_NOM="PumpIT"

supabase functions deploy send-notification
supabase functions deploy notification-poller
```

L'adresse d'expéditeur (`BREVO_SENDER_EMAIL`) doit être validée dans Brevo (Senders & IP →
Senders) avant le premier envoi, sinon Brevo refuse le message.

## 4. Programmer le passage périodique

`notification-poller` doit être appelée régulièrement (ex. toutes les 15 minutes) pour détecter
les nouveaux événements et envoyer les e-mails correspondants.

Depuis le dashboard Supabase : **Edge Functions → notification-poller → Cron** → ajoute un
planning (ex. `*/15 * * * *`). Si cette option n'est pas disponible sur ton plan, alternative via
`pg_cron` + `pg_net` (voir conversation — requête SQL fournie séparément, avec ta service_role key
posée directement dans Supabase, jamais dans le code).

## 5. Utilisation

Back-office PumpIT → **Notifications** (réservé au super administrateur) : crée/édite des règles
(déclencheur → destinataires → sujet/corps HTML → offres concernées), teste l'envoi sur ta propre
adresse avant d'activer, consulte l'historique d'envoi en bas de la page.

## 6. Catalogue des déclencheurs (voir `notification-poller/index.ts` pour en ajouter)

| Déclencheur | Variables | Destinataires par défaut |
|---|---|---|
| `user_signup` | `{{nom}}`, `{{email}}` | le nouvel inscrit |
| `versement_manquant` / `versement_incomplet` | `{{station}}`, `{{date}}`, `{{detail}}` | admin + directeur de la station |
| `ecart_caisse` / `ecart_compteur` / `ecart_stock` / `stock_bas` / `point_manquant` / `releve_compteur_manquant` / `depense_non_justifiee` | `{{station}}`, `{{date}}`, `{{detail}}` | admin + directeur de la station |
| `commande_a_valider` | `{{station}}`, `{{produit}}`, `{{quantite}}`, `{{date}}`, `{{gerant}}` | admin + directeur de la station |
| `commande_statut` | `{{station}}`, `{{produit}}`, `{{statut}}`, `{{valideur}}` | la personne qui a proposé la commande |
| `reception_ecart` | `{{station}}`, `{{produit}}`, `{{quantite_commandee}}`, `{{quantite_recue}}` | admin + directeur de la station |
| `prix_a_valider` | `{{station}}`, `{{produit}}`, `{{champ_label}}`, `{{prix_actuel}}`, `{{prix_demande}}`, `{{gerant}}` | admin + directeur de la station |
| `prix_statut` | `{{produit}}`, `{{champ_label}}`, `{{prix_demande}}`, `{{statut}}`, `{{valideur}}` | la personne qui a proposé le prix |
| `essai_j3` / `essai_termine` | `{{station}}`, `{{date_fin}}` | admin + directeur du client |
| `facture_emise` / `facture_retard` | `{{numero}}`, `{{montant}}`, `{{periode_debut}}`, `{{periode_fin}}` / `{{date_emission}}` | admin + directeur du client |
| `compte_a_valider` | `{{nom}}`, `{{email}}` | admin + directeur de l'organisation |
| `compte_retire` | `{{nom}}`, `{{email}}` | admin + directeur de l'organisation |
| `client_suspendu` | `{{station}}` | admin + directeur du client |

Chaque règle peut être limitée à une offre (`requiert_fonction` — réutilise les fonctions
d'offre existantes, ex. `alertes_completes` — ou `formules`, liste directe de clés d'offre).
Les deux vides = la règle s'applique à toutes les offres.
