-- ============================================================
--  MIGRATION v110 — Factures visibles par le directeur (lecture), et
--  conversion d'une facture d'abonnement en charge de station.
--
--  1) p_factures_sel élargie : jusqu'ici réservée à is_admin() côté
--     client — un directeur (qui a déjà view_finance) peut désormais
--     voir les factures de son organisation, en lecture (l'écriture
--     reste 100% réservée à la plateforme, policy p_factures_write
--     inchangée — un client ne peut jamais marquer sa propre facture
--     payée ou en changer le montant).
--
--  2) charges.facture_id : lien optionnel vers la facture d'origine,
--     posé quand l'admin (ou le comptable, via manage_finance — même
--     policy p_charges_all existante, inchangée) transforme une
--     facture d'abonnement PumpIT en charge pour une station — évite
--     de la transformer deux fois et sert de traçabilité.
-- ============================================================

alter table charges add column if not exists facture_id bigint references public.factures(id);
create index if not exists idx_charges_facture on charges(facture_id) where facture_id is not null;

drop policy if exists p_factures_sel on public.factures;
create policy p_factures_sel on public.factures for select to authenticated
  using (
    (select public.is_platform_admin())
    or (
      organisation_id = (select public.my_organisation_id())
      and ((select public.is_admin()) or (select public.has_permission('view_finance')))
    )
  );
