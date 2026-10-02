-- Fiche de contrôle/intervention enrichie (ANM, Bénin Pétro, agent dépanneur...) — la table
-- `inspections` ne gérait jusqu'ici qu'un contrôle générique (une seule ligne "pompes" en texte
-- libre, un prélevé/retour en cuve global, pas de motif ni d'agent ni de suivi par pompe).

alter table inspections add column if not exists motif text;
alter table inspections add column if not exists pieces_a_remplacer text;
alter table inspections add column if not exists actions_direction text;
alter table inspections add column if not exists a_adresser_direction boolean not null default false;
alter table inspections add column if not exists traite boolean not null default false;
alter table inspections add column if not exists agent_nom text;
alter table inspections add column if not exists agent_contact text;
alter table inspections add column if not exists heure_arrivee time;
alter table inspections add column if not exists heure_depart time;
-- Détail par pompe : [{pompe:'E1', produit:'essence', prelevement_litres, retour_cuve_litres,
-- index_avant, index_apres}, ...] — remplace le champ texte libre "pompes" pour les nouvelles
-- fiches (conservé pour l'historique, jamais retiré).
alter table inspections add column if not exists pompes_detail jsonb;

-- Aucune policy UPDATE n'existait sur inspections (seulement select/insert/delete) — nécessaire
-- pour que l'admin puisse marquer une action "à adresser au directeur" comme traitée.
drop policy if exists p_insp_upd on inspections;
create policy p_insp_upd on inspections for update using (is_admin()) with check (is_admin());
