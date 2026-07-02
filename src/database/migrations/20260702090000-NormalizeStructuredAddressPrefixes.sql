-- Normalize structured address fields to store the raw value only.
-- Display/geocode code adds Thai prefixes ("หมู่", "ตรอก", "ซอย", "ถนน") when composing an address.

UPDATE users
SET
  address_village_no = NULLIF(BTRIM(REGEXP_REPLACE(address_village_no, '^\s*หมู่\s*', '')), ''),
  address_trok = NULLIF(BTRIM(REGEXP_REPLACE(address_trok, '^\s*ตรอก\s*', '')), ''),
  address_soi = NULLIF(BTRIM(REGEXP_REPLACE(address_soi, '^\s*ซอย\s*', '')), ''),
  address_street = NULLIF(BTRIM(REGEXP_REPLACE(address_street, '^\s*ถนน\s*', '')), '')
WHERE address_village_no ~ '^\s*หมู่\s*'
  OR address_trok ~ '^\s*ตรอก\s*'
  OR address_soi ~ '^\s*ซอย\s*'
  OR address_street ~ '^\s*ถนน\s*';

UPDATE student_term
SET
  "VillageNumber_Onec" = NULLIF(BTRIM(REGEXP_REPLACE("VillageNumber_Onec"::text, '^\s*หมู่\s*', '')), ''),
  "Trok_Onec" = NULLIF(BTRIM(REGEXP_REPLACE("Trok_Onec", '^\s*ตรอก\s*', '')), ''),
  "Soi_Onec" = NULLIF(BTRIM(REGEXP_REPLACE("Soi_Onec", '^\s*ซอย\s*', '')), ''),
  "Street_Onec" = NULLIF(BTRIM(REGEXP_REPLACE("Street_Onec", '^\s*ถนน\s*', '')), '')
WHERE "VillageNumber_Onec"::text ~ '^\s*หมู่\s*'
  OR "Trok_Onec" ~ '^\s*ตรอก\s*'
  OR "Soi_Onec" ~ '^\s*ซอย\s*'
  OR "Street_Onec" ~ '^\s*ถนน\s*';

-- Down: no-op. Prefix stripping is a data normalization step and cannot be
-- restored exactly without preserving per-row historical intent.
