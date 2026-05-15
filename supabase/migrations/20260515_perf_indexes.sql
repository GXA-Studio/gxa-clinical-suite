-- Performance: B-Tree indexes for high-frequency lookup columns
-- These turn sequential scans into index seeks on the most queried paths.

-- Booking page: clinic lookup by slug (O(n) → O(log n))
CREATE INDEX IF NOT EXISTS idx_clinics_slug
  ON clinics(slug);

-- Services page + booking JOIN: filter by clinic + active flag
CREATE INDEX IF NOT EXISTS idx_services_clinic_active
  ON services(clinic_id, is_active);

-- Doctor step + booking JOIN: filter by clinic + active flag
CREATE INDEX IF NOT EXISTS idx_doctors_clinic_active
  ON doctors(clinic_id, is_active);

-- Slot availability: covers get_available_slots RPC queries.
-- Partial index (status <> 'cancelled') matches the EXCLUDE constraint predicate,
-- keeping index size minimal while covering all real availability checks.
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_slots
  ON appointments(doctor_id, starts_at, ends_at)
  WHERE status <> 'cancelled';

-- Admin dashboard: today/week range scans
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_starts
  ON appointments(clinic_id, starts_at);
