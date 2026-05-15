-- ================================================================
-- Medical Booking — Insurance Tables
-- File   : 20260515_insurances.sql
-- Adds   : insurances, doctor_insurances, RLS, seed data (Spain)
-- Status : Idempotent — safe to re-run
-- ================================================================

CREATE TABLE IF NOT EXISTS public.insurances (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  logo_url   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.doctor_insurances (
  doctor_id    uuid NOT NULL REFERENCES public.doctors(id)    ON DELETE CASCADE,
  insurance_id uuid NOT NULL REFERENCES public.insurances(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, insurance_id)
);

ALTER TABLE public.insurances        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_insurances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ins_public_read" ON public.insurances;
CREATE POLICY "ins_public_read" ON public.insurances FOR SELECT USING (true);

DROP POLICY IF EXISTS "di_public_read" ON public.doctor_insurances;
CREATE POLICY "di_public_read" ON public.doctor_insurances FOR SELECT USING (true);

-- Seed: principales mutuas en España
INSERT INTO public.insurances (name) VALUES
  ('Privado (sin mutua)'),
  ('Adeslas'),
  ('Sanitas'),
  ('Mapfre Salud'),
  ('Asisa'),
  ('DKV Seguros'),
  ('Allianz Care')
ON CONFLICT (name) DO NOTHING;
