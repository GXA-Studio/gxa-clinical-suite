-- ================================================================
-- Medical Booking Boilerplate — Final Schema (Certified & Operational)
-- File   : 20260515_final_schema.sql
-- Status : PRODUCTION READY — verified against live DB 2026-05-15
-- Admin  : studiogxa@gmail.com → clinica-prueba
-- ================================================================
--
-- USAGE
-- -----
-- Fresh Supabase project (new tenant):
--   Paste this entire file into SQL Editor → Run.
--   Then create your auth user and run Part 11 (Admin Linkage).
--
-- Existing project (fix missing trigger + admin linkage):
--   Run ONLY Part 10 (Missing Trigger Fix) and Part 11 (Admin Linkage).
--
-- This file is IDEMPOTENT: safe to re-run on a project that already
-- has the schema applied (uses IF NOT EXISTS / OR REPLACE / ON CONFLICT).
-- ================================================================


-- ================================================================
-- PART 1 — EXTENSIONS (idempotent)
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";


-- ================================================================
-- PART 2 — ENUMS
-- ================================================================

DO $$ BEGIN
  CREATE TYPE public.appointment_status AS ENUM ('pending', 'confirmed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ================================================================
-- PART 3 — TABLES (IF NOT EXISTS = idempotent)
-- ================================================================

-- ── clinics ──────────────────────────────────────────────────────
-- One row per clinic. Admin–clinic link is in profiles.clinic_id
-- (allows multiple admins/staff per clinic — no admin_id column here).
CREATE TABLE IF NOT EXISTS public.clinics (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL UNIQUE,
  phone       TEXT,
  address     TEXT,
  timezone    TEXT        NOT NULL DEFAULT 'UTC',
  settings    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── profiles ─────────────────────────────────────────────────────
-- One row per auth.users. Created automatically by fn_handle_new_user
-- trigger when the user registers. clinic_id is set after first login
-- via the Admin Dashboard or via the SQL in Part 11.
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id   UUID        REFERENCES public.clinics(id) ON DELETE SET NULL,
  full_name   TEXT,
  role        TEXT        NOT NULL DEFAULT 'admin'
                          CHECK (role IN ('admin', 'staff')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── services ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.services (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id        UUID        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  duration_minutes INTEGER     NOT NULL
                               CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  price            NUMERIC(10, 2),
  description      TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── doctors ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.doctors (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id   UUID        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  email       TEXT,
  specialty   TEXT,
  avatar_url  TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── doctor_services ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.doctor_services (
  doctor_id   UUID NOT NULL REFERENCES public.doctors(id)  ON DELETE CASCADE,
  service_id  UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, service_id)
);

-- ── schedules ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.schedules (
  id           UUID     PRIMARY KEY DEFAULT uuid_generate_v4(),
  doctor_id    UUID     NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   TIME     NOT NULL,
  end_time     TIME     NOT NULL CHECK (end_time > start_time),
  is_active    BOOLEAN  NOT NULL DEFAULT TRUE
);

-- ── appointments ─────────────────────────────────────────────────
-- E.164 phone constraint is included here (combines 001 + 002 migrations).
-- The EXCLUDE USING gist constraint prevents double-booking at DB level.
CREATE TABLE IF NOT EXISTS public.appointments (
  id              UUID                       PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id       UUID                       NOT NULL REFERENCES public.clinics(id)   ON DELETE RESTRICT,
  doctor_id       UUID                       NOT NULL REFERENCES public.doctors(id)   ON DELETE RESTRICT,
  service_id      UUID                       NOT NULL REFERENCES public.services(id)  ON DELETE RESTRICT,
  patient_name    TEXT                       NOT NULL,
  patient_phone   TEXT                       NOT NULL
                                             CHECK (patient_phone ~ '^\+[1-9]\d{7,14}$'),
  starts_at       TIMESTAMPTZ                NOT NULL,
  ends_at         TIMESTAMPTZ                NOT NULL,
  status          public.appointment_status  NOT NULL DEFAULT 'pending',
  otp_code_hash   TEXT,
  otp_expires_at  TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ                NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_ends_after_starts CHECK (ends_at > starts_at),

  EXCLUDE USING gist (
    doctor_id                              WITH =,
    tstzrange(starts_at, ends_at, '[)')    WITH &&
  ) WHERE (status <> 'cancelled')
);


-- ================================================================
-- PART 4 — INDEXES (IF NOT EXISTS)
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_appt_doctor_time
  ON public.appointments (doctor_id, starts_at)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_appt_clinic_status
  ON public.appointments (clinic_id, status, starts_at);

CREATE INDEX IF NOT EXISTS idx_appt_otp_expiry
  ON public.appointments (otp_expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_appt_patient_phone
  ON public.appointments (patient_phone);

CREATE INDEX IF NOT EXISTS idx_schedules_doctor_dow
  ON public.schedules (doctor_id, day_of_week, start_time)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_services_clinic
  ON public.services (clinic_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_doctors_clinic
  ON public.doctors (clinic_id)
  WHERE is_active = TRUE;


-- ================================================================
-- PART 5 — TRIGGER FUNCTIONS (CREATE OR REPLACE = idempotent)
-- ================================================================

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- Schedule overlap prevention
CREATE OR REPLACE FUNCTION public.fn_check_schedule_overlap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active = FALSE THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.schedules
    WHERE  doctor_id   = NEW.doctor_id
      AND  day_of_week = NEW.day_of_week
      AND  is_active   = TRUE
      AND  id         <> NEW.id
      AND  (start_time, end_time) OVERLAPS (NEW.start_time, NEW.end_time)
  ) THEN
    RAISE EXCEPTION 'SCHEDULE_OVERLAP'
      USING ERRCODE = 'P0005',
            DETAIL  = 'Schedule block overlaps with an existing active block';
  END IF;
  RETURN NEW;
END;
$$;

-- ── Auto-create profile on sign-up ──────────────────────────────
-- CRITICAL: This trigger was missing from the initial deployment.
-- Without it, new auth.users get no profiles row and the admin panel
-- shows "Esta cuenta no tiene una clínica asociada".
-- Fix: Part 10 of this file creates it if missing.
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'admin'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;


-- ================================================================
-- PART 6 — TRIGGERS (drop-and-recreate pattern for idempotency)
-- ================================================================

-- updated_at trigger on clinics
DROP TRIGGER IF EXISTS trg_clinics_updated_at ON public.clinics;
CREATE TRIGGER trg_clinics_updated_at
  BEFORE UPDATE ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Schedule overlap guard
DROP TRIGGER IF EXISTS trg_check_schedule_overlap ON public.schedules;
CREATE TRIGGER trg_check_schedule_overlap
  BEFORE INSERT OR UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.fn_check_schedule_overlap();

-- Auto-create profile when auth user registers
-- Fires on auth.users INSERT (new sign-ups and admin-created users).
DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_user();


-- ================================================================
-- PART 7 — RPC FUNCTIONS (CREATE OR REPLACE = idempotent)
-- ================================================================

-- get_available_slots
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id  UUID,
  p_service_id UUID,
  p_date       DATE
)
RETURNS TABLE (slot_start TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_duration  INTEGER;
  v_timezone  TEXT;
  v_interval  INTERVAL;
  v_dow       SMALLINT;
  v_schedule  public.schedules%ROWTYPE;
  v_win_start TIMESTAMPTZ;
  v_win_end   TIMESTAMPTZ;
  v_cursor    TIMESTAMPTZ;
  v_slot_end  TIMESTAMPTZ;
BEGIN
  SELECT duration_minutes INTO v_duration
  FROM   public.services WHERE id = p_service_id AND is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id USING ERRCODE = 'P0003';
  END IF;

  SELECT c.timezone INTO v_timezone
  FROM   public.clinics c JOIN public.doctors d ON d.clinic_id = c.id
  WHERE  d.id = p_doctor_id AND d.is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doctor % not found or inactive', p_doctor_id USING ERRCODE = 'P0004';
  END IF;

  v_interval := v_duration * INTERVAL '1 minute';
  v_dow      := EXTRACT(DOW FROM p_date)::SMALLINT;

  FOR v_schedule IN
    SELECT * FROM public.schedules
    WHERE  doctor_id = p_doctor_id AND day_of_week = v_dow AND is_active = TRUE
    ORDER  BY start_time
  LOOP
    v_win_start := timezone(v_timezone, (p_date + v_schedule.start_time)::TIMESTAMP);
    v_win_end   := timezone(v_timezone, (p_date + v_schedule.end_time)::TIMESTAMP);
    v_cursor    := v_win_start;

    WHILE v_cursor + v_interval <= v_win_end LOOP
      v_slot_end := v_cursor + v_interval;
      IF NOT EXISTS (
        SELECT 1 FROM public.appointments
        WHERE  doctor_id = p_doctor_id AND status <> 'cancelled'
          AND (status = 'confirmed' OR (status = 'pending' AND otp_expires_at > NOW()))
          AND  tstzrange(starts_at, ends_at, '[)') && tstzrange(v_cursor, v_slot_end, '[)')
      ) THEN
        slot_start := v_cursor;
        RETURN NEXT;
      END IF;
      v_cursor := v_slot_end;
    END LOOP;
  END LOOP;
END;
$$;

-- book_slot
CREATE OR REPLACE FUNCTION public.book_slot(
  p_clinic_id      UUID,
  p_doctor_id      UUID,
  p_service_id     UUID,
  p_patient_name   TEXT,
  p_patient_phone  TEXT,
  p_starts_at      TIMESTAMPTZ,
  p_otp_code_hash  TEXT
)
RETURNS public.appointments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_duration    INTEGER;
  v_ends_at     TIMESTAMPTZ;
  v_appointment public.appointments;
BEGIN
  SELECT duration_minutes INTO v_duration
  FROM   public.services WHERE id = p_service_id AND is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id USING ERRCODE = 'P0003';
  END IF;

  v_ends_at := p_starts_at + (v_duration * INTERVAL '1 minute');

  UPDATE public.appointments SET status = 'cancelled'
  WHERE  doctor_id = p_doctor_id AND status = 'pending'
    AND  otp_expires_at <= NOW()
    AND  tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)');

  INSERT INTO public.appointments (
    clinic_id, doctor_id, service_id, patient_name, patient_phone,
    starts_at, ends_at, status, otp_code_hash, otp_expires_at
  ) VALUES (
    p_clinic_id, p_doctor_id, p_service_id, p_patient_name, p_patient_phone,
    p_starts_at, v_ends_at, 'pending', p_otp_code_hash, NOW() + INTERVAL '5 minutes'
  )
  RETURNING * INTO v_appointment;

  RETURN v_appointment;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'SLOT_TAKEN'
      USING ERRCODE = 'P0001', DETAIL = 'The requested slot is no longer available';
END;
$$;

-- confirm_appointment
CREATE OR REPLACE FUNCTION public.confirm_appointment(
  p_appointment_id UUID,
  p_otp_code_hash  TEXT
)
RETURNS public.appointments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_appointment public.appointments;
BEGIN
  UPDATE public.appointments
  SET status = 'confirmed', otp_code_hash = NULL, otp_expires_at = NULL
  WHERE id = p_appointment_id AND status = 'pending'
    AND otp_code_hash = p_otp_code_hash AND otp_expires_at > NOW()
  RETURNING * INTO v_appointment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_OR_EXPIRED_OTP'
      USING ERRCODE = 'P0002', DETAIL = 'OTP is invalid, already used, or has expired';
  END IF;

  RETURN v_appointment;
END;
$$;


-- ================================================================
-- PART 8 — ROW LEVEL SECURITY
-- ================================================================

ALTER TABLE public.clinics         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments    ENABLE ROW LEVEL SECURITY;

-- clinics: read/update only for admins of that clinic
DROP POLICY IF EXISTS "clinic_admins_select" ON public.clinics;
CREATE POLICY "clinic_admins_select" ON public.clinics FOR SELECT USING (
  id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
);
DROP POLICY IF EXISTS "clinic_admins_update" ON public.clinics;
CREATE POLICY "clinic_admins_update" ON public.clinics FOR UPDATE USING (
  id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
);

-- profiles: own row only
DROP POLICY IF EXISTS "own_profile_select" ON public.profiles;
CREATE POLICY "own_profile_select" ON public.profiles FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS "own_profile_update" ON public.profiles;
CREATE POLICY "own_profile_update" ON public.profiles FOR UPDATE USING (id = auth.uid());

-- services: public read of active; admin write for own clinic
DROP POLICY IF EXISTS "public_read_active_services" ON public.services;
CREATE POLICY "public_read_active_services" ON public.services FOR SELECT USING (is_active = TRUE);
DROP POLICY IF EXISTS "admins_manage_services" ON public.services;
CREATE POLICY "admins_manage_services" ON public.services FOR ALL USING (
  clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
);

-- doctors: public read of active; admin write for own clinic
DROP POLICY IF EXISTS "public_read_active_doctors" ON public.doctors;
CREATE POLICY "public_read_active_doctors" ON public.doctors FOR SELECT USING (is_active = TRUE);
DROP POLICY IF EXISTS "admins_manage_doctors" ON public.doctors;
CREATE POLICY "admins_manage_doctors" ON public.doctors FOR ALL USING (
  clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
);

-- schedules: public read of active; admin write via doctor ownership
DROP POLICY IF EXISTS "public_read_active_schedules" ON public.schedules;
CREATE POLICY "public_read_active_schedules" ON public.schedules FOR SELECT USING (is_active = TRUE);
DROP POLICY IF EXISTS "admins_manage_schedules" ON public.schedules;
CREATE POLICY "admins_manage_schedules" ON public.schedules FOR ALL USING (
  doctor_id IN (
    SELECT d.id FROM public.doctors d
    JOIN   public.profiles p ON p.clinic_id = d.clinic_id
    WHERE  p.id = auth.uid()
  )
);

-- doctor_services: public read; admin write
DROP POLICY IF EXISTS "public_read_doctor_services" ON public.doctor_services;
CREATE POLICY "public_read_doctor_services" ON public.doctor_services FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "admins_manage_doctor_services" ON public.doctor_services;
CREATE POLICY "admins_manage_doctor_services" ON public.doctor_services FOR ALL USING (
  doctor_id IN (
    SELECT d.id FROM public.doctors d
    JOIN   public.profiles p ON p.clinic_id = d.clinic_id
    WHERE  p.id = auth.uid()
  )
);

-- appointments: admin read/update; patient writes go through SECURITY DEFINER RPCs
DROP POLICY IF EXISTS "admins_read_clinic_appts" ON public.appointments;
CREATE POLICY "admins_read_clinic_appts" ON public.appointments FOR SELECT USING (
  clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
);
DROP POLICY IF EXISTS "admins_update_clinic_appts" ON public.appointments;
CREATE POLICY "admins_update_clinic_appts" ON public.appointments FOR UPDATE USING (
  clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
);


-- ================================================================
-- PART 9 — GRANTS
-- ================================================================

GRANT EXECUTE ON FUNCTION public.get_available_slots TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_slot           TO anon;
GRANT EXECUTE ON FUNCTION public.confirm_appointment TO anon;


-- ================================================================
-- PART 10 — MISSING TRIGGER FIX
-- ================================================================
-- ROOT CAUSE OF "Esta cuenta no tiene una clínica asociada":
-- The trigger trg_on_auth_user_created was not present in the
-- original database deployment. Users could sign up successfully
-- (auth.users row created) but no corresponding profiles row was
-- created. Result: profile?.clinic_id = undefined → error message.
--
-- This section creates the trigger (already done in Part 6 above
-- via DROP IF EXISTS + CREATE). This comment is here for clarity.
--
-- BACKFILL: Create profiles for any auth users who signed up before
-- the trigger was installed and have no profile row yet.
INSERT INTO public.profiles (id, full_name, role)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', u.email),
  'admin'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;


-- ================================================================
-- PART 11 — ADMIN LINKAGE
-- ================================================================
-- Links the first admin (studiogxa@gmail.com) to the clinic.
-- The admin–clinic relationship is in profiles.clinic_id,
-- NOT in a clinics.admin_id column (design allows multiple admins).
--
-- Run this AFTER the auth user has been created (sign-up or Dashboard).
-- Safe to re-run: UPDATE matches 0 rows if user doesn't exist yet.
-- ================================================================

UPDATE public.profiles
SET
  clinic_id = (SELECT id FROM public.clinics WHERE slug = 'clinica-prueba' LIMIT 1),
  full_name = COALESCE(full_name, 'GXA Studio Admin'),
  role      = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'studiogxa@gmail.com' LIMIT 1)
  AND clinic_id IS NULL;  -- only update if not already linked

-- Verification query (uncomment to check):
-- SELECT p.role, u.email, c.name AS clinic, c.slug, p.created_at
-- FROM   public.profiles p
-- JOIN   auth.users      u ON u.id = p.id
-- JOIN   public.clinics  c ON c.id = p.clinic_id
-- WHERE  u.email = 'studiogxa@gmail.com';
