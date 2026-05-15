-- ================================================================
-- Medical Booking Boilerplate — Consolidated Initial Schema
-- File   : 20260515000000_initial_schema.sql
-- Version: 2026-05-15
-- ================================================================
--
-- PURPOSE
-- -------
-- This is the canonical, single-file schema for a FRESH Supabase
-- project. It consolidates migrations 001 + 002 into one document
-- to simplify new-tenant onboarding.
--
-- If you are upgrading an EXISTING project that already has 001/002
-- applied, do NOT run this file — you will get duplicate object
-- errors. Instead, apply only the incremental migrations you have
-- not yet run.
--
-- ARCHITECTURE: Single-Tenant (one Supabase project per clinic)
-- ---------------------------------------------------------------
-- Each tenant gets their own isolated Supabase project.
-- Deployment steps:
--   1. Create a new Supabase project.
--   2. Paste this file into the SQL Editor and run it, OR:
--      npx supabase db push --project-ref <your-project-ref>
--   3. Create the first admin user via Supabase Auth (Dashboard or
--      the /auth/login sign-up flow).
--   4. Run the SEED section at the bottom (or via the Admin UI).
-- ================================================================


-- ================================================================
-- PART 1 — EXTENSIONS
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- btree_gist: required for the EXCLUDE constraint on appointments.
-- Enables mixing btree-indexable types (UUID, SMALLINT) with range
-- types (tstzrange) in the same GiST index.
CREATE EXTENSION IF NOT EXISTS "btree_gist";


-- ================================================================
-- PART 2 — ENUM TYPES
-- ================================================================

CREATE TYPE public.appointment_status AS ENUM ('pending', 'confirmed', 'cancelled');


-- ================================================================
-- PART 3 — TABLES
-- ================================================================

-- ── clinics ─────────────────────────────────────────────────────
-- One row per tenant. In single-tenant mode, this table holds
-- exactly one row. Multi-tenant mode (multiple clinics per DB) is
-- supported by the schema but is NOT the recommended deployment.
--
-- Admin linkage: done via the `profiles` table (see below).
-- profiles.clinic_id → clinics.id is the canonical FK.
-- There is intentionally NO admin_id column in clinics — a clinic
-- can have multiple admins/staff, all represented in profiles.
CREATE TABLE public.clinics (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL UNIQUE,         -- URL path segment: /[clinicSlug]
  phone       TEXT,
  address     TEXT,
  timezone    TEXT        NOT NULL DEFAULT 'UTC',  -- IANA tz, e.g. 'America/Mexico_City'
  settings    JSONB       NOT NULL DEFAULT '{}',   -- logo_url, accent_color, etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── profiles ─────────────────────────────────────────────────────
-- Admin and staff users. One profile per auth.users row.
-- The profile is created automatically by a trigger when a new
-- Supabase Auth user registers (see PART 5 — TRIGGERS).
-- clinic_id ties the user to their clinic; NULL until assigned.
CREATE TABLE public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id   UUID        REFERENCES public.clinics(id) ON DELETE SET NULL,
  full_name   TEXT,
  role        TEXT        NOT NULL DEFAULT 'admin'
                          CHECK (role IN ('admin', 'staff')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── services ─────────────────────────────────────────────────────
CREATE TABLE public.services (
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
CREATE TABLE public.doctors (
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
-- Many-to-many: which doctors offer which services.
CREATE TABLE public.doctor_services (
  doctor_id   UUID NOT NULL REFERENCES public.doctors(id)  ON DELETE CASCADE,
  service_id  UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (doctor_id, service_id)
);

-- ── schedules ────────────────────────────────────────────────────
-- Weekly recurring availability blocks.
-- Multiple rows per (doctor_id, day_of_week) are allowed for
-- split shifts (morning + afternoon). Overlaps are prevented by
-- the trg_check_schedule_overlap trigger (see PART 5).
-- Times are stored in the CLINIC'S LOCAL timezone (not UTC).
-- The get_available_slots RPC converts to UTC at query time using
-- timezone(clinic.timezone, local_ts).
CREATE TABLE public.schedules (
  id           UUID     PRIMARY KEY DEFAULT uuid_generate_v4(),
  doctor_id    UUID     NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun … 6=Sat
  start_time   TIME     NOT NULL,
  end_time     TIME     NOT NULL CHECK (end_time > start_time),
  is_active    BOOLEAN  NOT NULL DEFAULT TRUE
);

-- ── appointments ─────────────────────────────────────────────────
-- Core booking table. Timestamps always stored in UTC (TIMESTAMPTZ).
--
-- DOUBLE-BOOKING PREVENTION
-- The EXCLUDE constraint below is the primary safety net against
-- race conditions. It ensures that for any two non-cancelled
-- appointments of the same doctor, their half-open time ranges
-- [starts_at, ends_at) cannot overlap.
--
-- PostgreSQL serializes concurrent INSERTs via predicate locks on
-- the GiST index. If two requests claim the same slot simultaneously,
-- one succeeds and the other receives SQLSTATE 23P01 (exclusion_
-- violation), which the book_slot RPC re-raises as SLOT_TAKEN (P0001).
--
-- Half-open [) semantics: 09:00–09:30 and 09:30–10:00 do NOT
-- conflict, enabling back-to-back appointments.
CREATE TABLE public.appointments (
  id              UUID                       PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id       UUID                       NOT NULL REFERENCES public.clinics(id)   ON DELETE RESTRICT,
  doctor_id       UUID                       NOT NULL REFERENCES public.doctors(id)   ON DELETE RESTRICT,
  service_id      UUID                       NOT NULL REFERENCES public.services(id)  ON DELETE RESTRICT,
  patient_name    TEXT                       NOT NULL,
  patient_phone   TEXT                       NOT NULL
                                             CHECK (patient_phone ~ '^\+[1-9]\d{7,14}$'), -- E.164
  starts_at       TIMESTAMPTZ                NOT NULL,
  ends_at         TIMESTAMPTZ                NOT NULL,
  status          public.appointment_status  NOT NULL DEFAULT 'pending',
  otp_code_hash   TEXT,          -- SHA-256 hex of OTP; NULL after confirmation
  otp_expires_at  TIMESTAMPTZ,   -- 5-minute TTL; NULL after confirmation
  notes           TEXT,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_ends_after_starts CHECK (ends_at > starts_at),

  EXCLUDE USING gist (
    doctor_id                              WITH =,
    tstzrange(starts_at, ends_at, '[)')    WITH &&
  ) WHERE (status <> 'cancelled')
);


-- ================================================================
-- PART 4 — INDEXES
-- ================================================================

-- Doctor's upcoming non-cancelled appointments (hot path)
CREATE INDEX idx_appt_doctor_time
  ON public.appointments (doctor_id, starts_at)
  WHERE status <> 'cancelled';

-- Clinic calendar view filtered by status
CREATE INDEX idx_appt_clinic_status
  ON public.appointments (clinic_id, status, starts_at);

-- OTP expiry cleanup in book_slot
CREATE INDEX idx_appt_otp_expiry
  ON public.appointments (otp_expires_at)
  WHERE status = 'pending';

-- Patient phone lookup
CREATE INDEX idx_appt_patient_phone
  ON public.appointments (patient_phone);

-- Schedule lookup (hot path in get_available_slots)
CREATE INDEX idx_schedules_doctor_dow
  ON public.schedules (doctor_id, day_of_week, start_time)
  WHERE is_active = TRUE;

-- Active services per clinic
CREATE INDEX idx_services_clinic
  ON public.services (clinic_id)
  WHERE is_active = TRUE;

-- Active doctors per clinic
CREATE INDEX idx_doctors_clinic
  ON public.doctors (clinic_id)
  WHERE is_active = TRUE;


-- ================================================================
-- PART 5 — TRIGGERS
-- ================================================================

-- ── updated_at maintenance ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clinics_updated_at
  BEFORE UPDATE ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ── Auto-create profile on user sign-up ─────────────────────────
-- When a new user registers via Supabase Auth, create a matching
-- profile row with role='admin'. The admin then associates
-- themselves with a clinic via the Admin Dashboard.
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

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_user();

-- ── Schedule overlap prevention ──────────────────────────────────
-- Prevents two active schedule blocks for the same doctor+day from
-- overlapping. Uses PostgreSQL's OVERLAPS operator with half-open
-- semantics: (09:00, 13:00) OVERLAPS (13:00, 17:00) = FALSE,
-- so morning/afternoon splits work correctly.
CREATE OR REPLACE FUNCTION public.fn_check_schedule_overlap()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active = FALSE THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM   public.schedules
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

CREATE TRIGGER trg_check_schedule_overlap
  BEFORE INSERT OR UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.fn_check_schedule_overlap();


-- ================================================================
-- PART 6 — RPC FUNCTIONS (Security Definer)
-- ================================================================

-- ── get_available_slots ──────────────────────────────────────────
-- Returns UTC slot-start timestamps free for a given doctor +
-- service on a local calendar date. Supports multiple schedule
-- blocks per day (morning + afternoon shifts).
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id  UUID,
  p_service_id UUID,
  p_date       DATE  -- local calendar date in clinic's timezone
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
  FROM   public.services
  WHERE  id = p_service_id AND is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id USING ERRCODE = 'P0003';
  END IF;

  SELECT c.timezone INTO v_timezone
  FROM   public.clinics c
  JOIN   public.doctors d ON d.clinic_id = c.id
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
    -- timezone(tz, local_ts) interprets the timestamp as being IN tz → returns UTC.
    -- Handles DST automatically.
    v_win_start := timezone(v_timezone, (p_date + v_schedule.start_time)::TIMESTAMP);
    v_win_end   := timezone(v_timezone, (p_date + v_schedule.end_time)::TIMESTAMP);
    v_cursor    := v_win_start;

    WHILE v_cursor + v_interval <= v_win_end LOOP
      v_slot_end := v_cursor + v_interval;

      IF NOT EXISTS (
        SELECT 1 FROM public.appointments
        WHERE  doctor_id = p_doctor_id
          AND  status   <> 'cancelled'
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

-- ── book_slot ────────────────────────────────────────────────────
-- Atomically cancels expired-pending appointments blocking the
-- requested slot, then inserts a new PENDING appointment.
-- The EXCLUDE constraint is the true concurrency safety net.
-- Caller must hash OTP before calling — plaintext never stored.
CREATE OR REPLACE FUNCTION public.book_slot(
  p_clinic_id      UUID,
  p_doctor_id      UUID,
  p_service_id     UUID,
  p_patient_name   TEXT,
  p_patient_phone  TEXT,
  p_starts_at      TIMESTAMPTZ,
  p_otp_code_hash  TEXT   -- SHA-256 hex of plaintext OTP
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

  -- Release expired-pending appointments (same transaction → atomic)
  UPDATE public.appointments
  SET    status = 'cancelled'
  WHERE  doctor_id      = p_doctor_id
    AND  status         = 'pending'
    AND  otp_expires_at <= NOW()
    AND  tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)');

  INSERT INTO public.appointments (
    clinic_id, doctor_id, service_id,
    patient_name, patient_phone,
    starts_at, ends_at,
    status, otp_code_hash, otp_expires_at
  ) VALUES (
    p_clinic_id, p_doctor_id, p_service_id,
    p_patient_name, p_patient_phone,
    p_starts_at, v_ends_at,
    'pending', p_otp_code_hash, NOW() + INTERVAL '5 minutes'
  )
  RETURNING * INTO v_appointment;

  RETURN v_appointment;

EXCEPTION
  WHEN exclusion_violation THEN  -- SQLSTATE 23P01
    RAISE EXCEPTION 'SLOT_TAKEN'
      USING ERRCODE = 'P0001',
            DETAIL  = 'The requested slot is no longer available';
END;
$$;

-- ── confirm_appointment ──────────────────────────────────────────
-- Verifies OTP hash, confirms the appointment, clears OTP fields.
-- Raises P0002 on hash mismatch or expiry → replay-proof.
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
  SET
    status         = 'confirmed',
    otp_code_hash  = NULL,
    otp_expires_at = NULL
  WHERE id             = p_appointment_id
    AND status         = 'pending'
    AND otp_code_hash  = p_otp_code_hash
    AND otp_expires_at > NOW()
  RETURNING * INTO v_appointment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_OR_EXPIRED_OTP'
      USING ERRCODE = 'P0002',
            DETAIL  = 'OTP is invalid, already used, or has expired';
  END IF;

  RETURN v_appointment;
END;
$$;


-- ================================================================
-- PART 7 — ROW LEVEL SECURITY (RLS)
-- ================================================================

-- clinics: only admins of that clinic can read/update their row
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinic_admins_select" ON public.clinics
  FOR SELECT USING (
    id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
  );
CREATE POLICY "clinic_admins_update" ON public.clinics
  FOR UPDATE USING (
    id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
  );

-- profiles: each user sees and edits only their own row
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_profile_select" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "own_profile_update" ON public.profiles FOR UPDATE USING (id = auth.uid());

-- services: public read for active rows; admin write for own clinic
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_active_services" ON public.services
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "admins_manage_services" ON public.services
  FOR ALL USING (
    clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
  );

-- doctors: public read for active rows; admin write for own clinic
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_active_doctors" ON public.doctors
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "admins_manage_doctors" ON public.doctors
  FOR ALL USING (
    clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
  );

-- schedules: public read for active rows; admin write for own clinic's doctors
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_active_schedules" ON public.schedules
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "admins_manage_schedules" ON public.schedules
  FOR ALL USING (
    doctor_id IN (
      SELECT d.id FROM public.doctors d
      JOIN   public.profiles p ON p.clinic_id = d.clinic_id
      WHERE  p.id = auth.uid()
    )
  );

-- doctor_services: public read; admin write for own clinic's doctors
ALTER TABLE public.doctor_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_doctor_services" ON public.doctor_services
  FOR SELECT USING (TRUE);
CREATE POLICY "admins_manage_doctor_services" ON public.doctor_services
  FOR ALL USING (
    doctor_id IN (
      SELECT d.id FROM public.doctors d
      JOIN   public.profiles p ON p.clinic_id = d.clinic_id
      WHERE  p.id = auth.uid()
    )
  );

-- appointments: patients never access directly — all writes via SECURITY DEFINER RPCs
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_read_clinic_appts" ON public.appointments
  FOR SELECT USING (
    clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
  );
CREATE POLICY "admins_update_clinic_appts" ON public.appointments
  FOR UPDATE USING (
    clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL)
  );


-- ================================================================
-- PART 8 — GRANTS
-- Anon role can call public-facing RPCs (SECURITY DEFINER → runs
-- as postgres owner, RLS does not apply inside these functions).
-- ================================================================

GRANT EXECUTE ON FUNCTION public.get_available_slots TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_slot           TO anon;
GRANT EXECUTE ON FUNCTION public.confirm_appointment TO anon;


-- ================================================================
-- PART 9 — SEED DATA (clinic-prueba + admin linkage)
-- ================================================================
--
-- Run this section AFTER the Supabase Auth user has been created.
-- The admin must sign up first so their UUID exists in auth.users.
--
-- Step-by-step:
--   1. Go to Supabase Dashboard → Authentication → Add user
--      Email: studiogxa@gmail.com  (or use the /auth/login page)
--   2. Run the SQL below in the SQL Editor.
-- ================================================================

-- Create the demo clinic
INSERT INTO public.clinics (name, slug, timezone, phone, address, settings)
VALUES (
  'Clínica Prueba GXA',
  'clinica-prueba',
  'Europe/Madrid',
  '+34600000000',
  'Calle Mayor 1, 07800 Ibiza',
  '{"accent_color": "#2563eb", "logo_url": null}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Add sample services
INSERT INTO public.services (clinic_id, name, duration_minutes, price, description)
SELECT
  c.id,
  svc.name,
  svc.dur,
  svc.price,
  svc.desc
FROM public.clinics c,
  (VALUES
    ('Consulta General',    30, 50.00,  'Evaluación médica general con diagnóstico y receta.'),
    ('Revisión Anual',      45, 80.00,  'Chequeo completo con analítica básica.'),
    ('Pediatría',           30, 60.00,  'Consulta pediátrica para menores de 14 años.')
  ) AS svc(name, dur, price, desc)
WHERE c.slug = 'clinica-prueba'
ON CONFLICT DO NOTHING;

-- Add sample doctor
INSERT INTO public.doctors (clinic_id, name, email, specialty)
SELECT c.id, 'Dr. Alejandro Ruiz', 'alejandro.ruiz@clinica-prueba.com', 'Medicina General'
FROM public.clinics c WHERE c.slug = 'clinica-prueba'
ON CONFLICT DO NOTHING;

-- Link doctor to all services of this clinic
INSERT INTO public.doctor_services (doctor_id, service_id)
SELECT d.id, s.id
FROM   public.doctors  d
JOIN   public.clinics  c  ON c.id  = d.clinic_id
JOIN   public.services s  ON s.clinic_id = c.id
WHERE  c.slug = 'clinica-prueba'
  AND  d.name = 'Dr. Alejandro Ruiz'
ON CONFLICT DO NOTHING;

-- Add schedules: Mon–Fri, morning 09:00–14:00 and afternoon 16:00–19:00
INSERT INTO public.schedules (doctor_id, day_of_week, start_time, end_time)
SELECT
  d.id,
  gs.day,
  block.start_t::TIME,
  block.end_t::TIME
FROM public.doctors d
JOIN public.clinics c ON c.id = d.clinic_id,
  generate_series(1, 5) AS gs(day),
  (VALUES ('09:00', '14:00'), ('16:00', '19:00')) AS block(start_t, end_t)
WHERE c.slug = 'clinica-prueba'
  AND d.name = 'Dr. Alejandro Ruiz'
ON CONFLICT DO NOTHING;

-- ── Admin linkage ──────────────────────────────────────────────────────────
-- Links the Supabase Auth user (studiogxa@gmail.com) to this clinic
-- via the profiles table. The trigger fn_handle_new_user already created
-- the profile row when the user signed up; this UPDATE sets clinic_id.
--
-- If the user does not yet exist in auth.users, this is a safe no-op
-- (UPDATE matches 0 rows). Re-run after the user signs up.
--
-- NOTE: "admin_id in clinics" is not a column in this schema — the
-- admin-clinic relationship is modelled through profiles.clinic_id.
-- This is more flexible: multiple admins/staff per clinic.
-- ──────────────────────────────────────────────────────────────────────────
UPDATE public.profiles
SET    clinic_id = (SELECT id FROM public.clinics WHERE slug = 'clinica-prueba'),
       full_name = COALESCE(full_name, 'GXA Studio Admin'),
       role      = 'admin'
WHERE  id = (SELECT id FROM auth.users WHERE email = 'studiogxa@gmail.com');

-- Verify the linkage (should return 1 row if user exists)
-- SELECT p.id, u.email, p.role, c.name AS clinic, c.slug
-- FROM   public.profiles p
-- JOIN   auth.users     u ON u.id = p.id
-- JOIN   public.clinics c ON c.id = p.clinic_id
-- WHERE  u.email = 'studiogxa@gmail.com';
