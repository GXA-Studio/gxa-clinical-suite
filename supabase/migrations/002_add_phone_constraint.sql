-- =============================================================
-- Migration 002 — M-01 Security Fix
-- Add E.164 CHECK constraint to appointments.patient_phone
--
-- Ensures phone format is enforced at the database level,
-- not only in the API layer. Protects all write paths
-- (migrations, Supabase Studio, future admin routes).
-- =============================================================

ALTER TABLE public.appointments
  ADD CONSTRAINT chk_patient_phone_e164
  CHECK (patient_phone ~ '^\+[1-9]\d{7,14}$');
