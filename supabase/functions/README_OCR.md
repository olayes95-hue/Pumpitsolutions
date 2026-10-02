# Module OCR bordereaux — déploiement

La lecture automatique des photos se fait côté serveur (la clé IA ne doit pas être dans le navigateur).
Il faut : (1) une clé API Anthropic, (2) déployer la fonction `ocr-bordereau`.

## 1. Base de données
Dans Supabase → SQL Editor → lance **`supabase/migration_v10.sql`** (colonnes OCR sur `deposits`).

## 2. Clé API Anthropic
Crée une clé sur https://console.anthropic.com → API Keys (format `sk-ant-...`).

## 3. Déployer la fonction

### Option A — En ligne de commande (recommandé)
```bash
# une seule fois : installer et se connecter
npm i -g supabase
supabase login
supabase link --project-ref zawfqppfnxeukdzcczet   # ton "project ref" (dans l'URL du projet)

# depuis le dossier station-app :
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
supabase functions deploy ocr-bordereau
```

### Option B — Depuis le dashboard Supabase
1. Supabase → **Edge Functions** → *Create a new function* → nom : `ocr-bordereau`.
2. Colle le contenu de `supabase/functions/ocr-bordereau/index.ts` → *Deploy*.
3. Supabase → *Project Settings → Edge Functions → Secrets* (ou *Settings → Functions*) →
   ajoute **`ANTHROPIC_API_KEY`** = ta clé.

## 4. Utilisation
Dans l'app (admin) → onglet **« Vérif bordereaux »** → bouton **Analyser** sur une ligne :
la fonction lit le montant sur la photo et l'affiche à côté du montant déclaré, avec l'écart
(✓ OK si identique à ±100 F, rouge sinon).

## Coût & fiabilité
- Coût : quelques centimes par image (facturé par Anthropic).
- Très fiable sur les reçus imprimés (BOA). Tu peux ré-analyser à tout moment.
