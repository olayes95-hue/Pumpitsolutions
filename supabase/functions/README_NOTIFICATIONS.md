# Module notifications (Brevo) — déploiement

Comme pour `ocr-bordereau`, l'envoi d'e-mail se fait côté serveur : la clé Brevo ne doit jamais
être dans le navigateur.

## 1. Base de données
Supabase → SQL Editor → lance **`supabase/migration_v113_notifications.sql`**.

## 2. Clé Brevo
Crée une clé API sur https://app.brevo.com → SMTP & API → API Keys.

## 3. Secrets + déploiement des fonctions

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
les nouveaux événements (inscriptions, alertes hautes) et envoyer les e-mails correspondants.

Depuis le dashboard Supabase : **Edge Functions → notification-poller → Cron** → ajoute un
planning (ex. `*/15 * * * *`). Si cette option n'est pas disponible sur ton plan, une alternative
est un `pg_cron` + `pg_net` appelant l'URL de la fonction depuis la base — demande si besoin, ce
n'est pas inclus ici.

## 5. Utilisation

Back-office PumpIT → **Notifications** (réservé au super administrateur) : crée des règles
(déclencheur → destinataires → sujet/corps HTML), teste l'envoi sur ta propre adresse avant
d'activer, consulte l'historique d'envoi en bas de la page.

Déclencheurs disponibles aujourd'hui (voir `notification-poller/index.ts` pour en ajouter) :
- `user_signup` — nouveau compte créé. Variables : `{{nom}}`, `{{email}}`.
- `alerte_haute` — nouvelle alerte de gravité haute, toutes stations confondues. Variables :
  `{{station}}`, `{{type}}`, `{{detail}}`, `{{date}}`.
