-- ============================================================
-- LRP Gallery — Migração 41: rótulo customizável pros links externos
-- (fotos em alta / fotos em baixa)
--
-- POR QUÊ: os links "Link fotos em alta" / "Link fotos em baixa" no
-- admin (ex.: pasta do Google Drive) sempre mostravam esse texto fixo.
-- Pra um evento com fotos entregues em datas/lotes diferentes (ex.:
-- "FOTOS EM ALTA 17SET26" e "FOTOS EM ALTA 18SET26"), é útil poder
-- trocar esse rótulo por galeria, sem mexer em nenhuma outra.
--
-- Colunas novas, opcionais: quando nulas, o admin continua mostrando o
-- texto padrão de sempre — nenhuma galeria existente muda de aparência.
-- ============================================================
set search_path = public;

alter table galleries add column if not exists high_res_label text;
alter table galleries add column if not exists low_res_label text;
