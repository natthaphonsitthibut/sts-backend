ALTER TABLE student_term
  ADD COLUMN IF NOT EXISTS address_house_no TEXT,
  ADD COLUMN IF NOT EXISTS address_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS address_longitude DOUBLE PRECISION;

ALTER TABLE student_term DROP CONSTRAINT IF EXISTS chk_student_term_address_coordinates;
ALTER TABLE student_term
  ADD CONSTRAINT chk_student_term_address_coordinates
  CHECK (
    (address_latitude IS NULL AND address_longitude IS NULL)
    OR (
      address_latitude BETWEEN -90 AND 90
      AND address_longitude BETWEEN -180 AND 180
    )
  ) NOT VALID;
ALTER TABLE student_term VALIDATE CONSTRAINT chk_student_term_address_coordinates;
