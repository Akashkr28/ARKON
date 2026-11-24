-- Engineering data measured on the CAD geometry (STEP uploads only): size, volume,
-- area, centre of mass, part number, material, holes / outer diameters / fillets.
-- Shape: see services/converter/holocad_converter/specs.py (keys in camelCase).
alter table model_parts add column spec jsonb;
