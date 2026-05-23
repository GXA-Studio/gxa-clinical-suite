-- =============================================================
-- Medical Booking Boilerplate — Sales Demo Seed
-- File   : supabase/seed_demo_sales.sql
-- Purpose: Populate the first clinic in `public.clinics` with a
--          realistic, sales-ready dataset anchored to CURRENT_DATE.
--          The admin agenda (/admin/agenda) will look full and
--          professional within seconds of running this script.
--
-- IDEMPOTENT — re-running this script removes the previous demo
-- footprint (identified by the markers below) and recreates it
-- against the current date.
--
-- DEMO MARKERS (used for cleanup, never touched in production data):
--   * doctors.email                  ~~ '%@demo.local'
--   * services.description           starts with '[DEMO_SEED]'
--   * appointments.notes             starts with 'DEMO_SEED'
--
-- SCHEMA AWARENESS:
--   * E.164 phone constraint  → all phones use '+34611xxxxxx' style
--   * status enum             → 'confirmed' | 'cancelled' (no pending)
--   * services.color allow-list → blue|emerald|purple|amber|rose
--   * EXCLUDE constraint      → no overlapping non-cancelled
--                               appointments for the same doctor;
--                               the time grid below is hand-tuned so
--                               every slot is unique per doctor.
-- =============================================================

BEGIN;

DO $$
DECLARE
  v_clinic_id     UUID;
  v_clinic_tz     TEXT;
  v_doctor_1      UUID;
  v_doctor_2      UUID;
  v_doctor_3      UUID;
  v_svc_fisio     UUID;
  v_svc_limpieza  UUID;
  v_svc_revision  UUID;
  v_svc_implante  UUID;
BEGIN
  -- ── 0. Resolve target tenant (first clinic in the table) ─────
  SELECT id, timezone
    INTO v_clinic_id, v_clinic_tz
  FROM   public.clinics
  ORDER  BY created_at
  LIMIT  1;

  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION
      'No clinic found. Create a row in public.clinics before running this seed.';
  END IF;

  RAISE NOTICE 'Seeding demo data into clinic % (timezone %)', v_clinic_id, v_clinic_tz;

  -- ── 1. Clean previous demo footprint ─────────────────────────
  -- Order respects the ON DELETE RESTRICT FK on appointments.doctor_id.
  DELETE FROM public.appointments
  WHERE  notes LIKE 'DEMO_SEED%';

  DELETE FROM public.doctor_schedule_exceptions
  WHERE  doctor_id IN (
    SELECT id FROM public.doctors WHERE email LIKE '%@demo.local'
  );

  DELETE FROM public.schedules
  WHERE  doctor_id IN (
    SELECT id FROM public.doctors WHERE email LIKE '%@demo.local'
  );

  DELETE FROM public.doctor_services
  WHERE  doctor_id IN (
    SELECT id FROM public.doctors WHERE email LIKE '%@demo.local'
  );

  DELETE FROM public.doctors  WHERE email       LIKE '%@demo.local';
  DELETE FROM public.services WHERE description LIKE '[DEMO_SEED]%';

  -- ── 2. Services (4 distinct colors for visual richness) ──────
  INSERT INTO public.services (clinic_id, name, duration_minutes, price, description, color)
       VALUES (v_clinic_id, 'Sesión de Fisioterapia',     45,  50.00,
               '[DEMO_SEED] Rehabilitación postural y muscular.',           'blue')
  RETURNING id INTO v_svc_fisio;

  INSERT INTO public.services (clinic_id, name, duration_minutes, price, description, color)
       VALUES (v_clinic_id, 'Limpieza Bucal',             30,  65.00,
               '[DEMO_SEED] Higiene dental profesional con ultrasonidos.',  'emerald')
  RETURNING id INTO v_svc_limpieza;

  INSERT INTO public.services (clinic_id, name, duration_minutes, price, description, color)
       VALUES (v_clinic_id, 'Revisión Médica General',    30,  40.00,
               '[DEMO_SEED] Chequeo y diagnóstico general.',                'amber')
  RETURNING id INTO v_svc_revision;

  INSERT INTO public.services (clinic_id, name, duration_minutes, price, description, color)
       VALUES (v_clinic_id, 'Consulta de Implante Dental', 60, 120.00,
               '[DEMO_SEED] Valoración y planificación de implante.',       'purple')
  RETURNING id INTO v_svc_implante;

  -- ── 3. Doctors (3 realistic Spanish profiles) ────────────────
  INSERT INTO public.doctors (clinic_id, name, email, specialty)
       VALUES (v_clinic_id, 'Dr. Carlos Ruiz',     'dr.carlos@demo.local', 'Fisioterapia')
  RETURNING id INTO v_doctor_1;

  INSERT INTO public.doctors (clinic_id, name, email, specialty)
       VALUES (v_clinic_id, 'Dra. Laura Martínez', 'dra.laura@demo.local', 'Odontología')
  RETURNING id INTO v_doctor_2;

  INSERT INTO public.doctors (clinic_id, name, email, specialty)
       VALUES (v_clinic_id, 'Dr. Javier Sánchez',  'dr.javier@demo.local', 'Medicina General')
  RETURNING id INTO v_doctor_3;

  -- ── 4. doctor ↔ service mapping ──────────────────────────────
  INSERT INTO public.doctor_services (doctor_id, service_id) VALUES
    (v_doctor_1, v_svc_fisio),
    (v_doctor_2, v_svc_limpieza),
    (v_doctor_2, v_svc_implante),
    (v_doctor_3, v_svc_revision),
    (v_doctor_3, v_svc_limpieza)   -- GP also offers hygiene check-ins
  ON CONFLICT DO NOTHING;

  -- ── 5. Weekly schedules ──────────────────────────────────────
  -- L–V 09:00–17:00 base; doctors 1 & 3 also work Saturday morning
  -- so the agenda has content regardless of when the demo runs.
  INSERT INTO public.schedules (doctor_id, day_of_week, start_time, end_time)
  SELECT v_doctor_1, dow, TIME '09:00', TIME '17:00'
    FROM generate_series(1, 5) dow
  UNION ALL SELECT v_doctor_1, 6, TIME '09:00', TIME '14:00'         -- Sábado
  UNION ALL
  SELECT v_doctor_2, dow, TIME '09:00', TIME '17:00'
    FROM generate_series(1, 5) dow
  UNION ALL
  SELECT v_doctor_3, dow, TIME '09:00', TIME '17:00'
    FROM generate_series(1, 5) dow
  UNION ALL SELECT v_doctor_3, 6, TIME '10:00', TIME '13:00';        -- Sábado

  -- ── 6. Visual exceptions in the current week ────────────────
  --   • Doctor 1 takes the whole day off TOMORROW (full-day rose stripe).
  --   • Doctor 2 has a meeting block 14:00–15:00 TODAY (amber stripe).
  INSERT INTO public.doctor_schedule_exceptions
    (doctor_id, exception_date, is_working, start_time,    end_time)
  VALUES
    (v_doctor_1, CURRENT_DATE + 1, FALSE, NULL,            NULL),
    (v_doctor_2, CURRENT_DATE,     FALSE, TIME '14:00',    TIME '15:00');

  -- ── 7. Appointments (18, anchored to the clinic timezone) ────
  -- Layout is hand-tuned per (doctor, day_offset, start_time) so
  -- no two non-cancelled rows for the same doctor overlap. None
  -- touch Doctor 1's day-off (CURRENT_DATE+1) or Doctor 2's
  -- 14:00–15:00 block (CURRENT_DATE), so the exceptions appear
  -- visually "clean" on the grid.
  INSERT INTO public.appointments
    (clinic_id, doctor_id, service_id, patient_name, patient_phone,
     starts_at, ends_at, status, color, notes)
  SELECT
    v_clinic_id,
    a.doctor_id,
    a.service_id,
    a.patient_name,
    a.patient_phone,
    timezone(v_clinic_tz,
             ((CURRENT_DATE + a.day_offset) + a.start_t)::TIMESTAMP),
    timezone(v_clinic_tz,
             ((CURRENT_DATE + a.day_offset) + a.start_t
              + (a.duration || ' minutes')::INTERVAL)::TIMESTAMP),
    a.status::public.appointment_status,
    a.color,
    'DEMO_SEED — '
      || (CURRENT_DATE + a.day_offset)::TEXT
      || ' @ '
      || a.start_t::TEXT
  FROM (VALUES
    -- ── Doctor 1 — Dr. Carlos Ruiz · Fisioterapia (45 min) ────
    (v_doctor_1, v_svc_fisio,    'María García López',      '+34611100001', -1, TIME '09:30', 45, 'confirmed', NULL),
    (v_doctor_1, v_svc_fisio,    'Carlos Rodríguez Pérez',  '+34611100002', -1, TIME '14:00', 45, 'confirmed', NULL),
    (v_doctor_1, v_svc_fisio,    'Ana Martínez Sánchez',    '+34611100003',  0, TIME '10:00', 45, 'confirmed', NULL),
    (v_doctor_1, v_svc_fisio,    'Javier López Fernández',  '+34611100004',  0, TIME '12:00', 45, 'confirmed', NULL),
    (v_doctor_1, v_svc_fisio,    'Laura Hernández García',  '+34611100005',  0, TIME '15:30', 45, 'confirmed', NULL),
    (v_doctor_1, v_svc_fisio,    'David Pérez Martín',      '+34611100006',  2, TIME '11:00', 45, 'confirmed', NULL),

    -- ── Doctor 2 — Dra. Laura Martínez · Odontología (30/60) ─
    -- Avoids the 14:00–15:00 partial block on CURRENT_DATE.
    (v_doctor_2, v_svc_limpieza, 'Isabel González Ruiz',    '+34622200001', -1, TIME '09:00', 30, 'confirmed', NULL),
    (v_doctor_2, v_svc_implante, 'Pablo Sánchez López',     '+34622200002', -1, TIME '11:00', 60, 'cancelled', NULL),
    (v_doctor_2, v_svc_limpieza, 'Lucía Romero Díaz',       '+34622200003',  0, TIME '09:30', 30, 'confirmed', NULL),
    (v_doctor_2, v_svc_limpieza, 'Adrián Jiménez Moreno',   '+34622200004',  0, TIME '11:00', 30, 'confirmed', 'rose'),
    (v_doctor_2, v_svc_implante, 'Sara Muñoz Álvarez',      '+34622200005',  0, TIME '15:30', 60, 'confirmed', NULL),
    (v_doctor_2, v_svc_limpieza, 'Daniel Álvarez Castro',   '+34622200006',  1, TIME '10:00', 30, 'confirmed', NULL),
    (v_doctor_2, v_svc_implante, 'Sofía Romero Vega',       '+34622200007',  1, TIME '13:30', 60, 'cancelled', NULL),
    (v_doctor_2, v_svc_limpieza, 'Manuel Ruiz Castillo',    '+34622200008',  2, TIME '12:00', 30, 'confirmed', NULL),

    -- ── Doctor 3 — Dr. Javier Sánchez · Medicina General (30) ─
    (v_doctor_3, v_svc_revision, 'Patricia Díaz Iglesias',  '+34633300001', -2, TIME '11:30', 30, 'confirmed', NULL),
    (v_doctor_3, v_svc_revision, 'Roberto Morales Ortega',  '+34633300002',  0, TIME '12:30', 30, 'confirmed', NULL),
    (v_doctor_3, v_svc_revision, 'Cristina Vega Suárez',    '+34633300003',  3, TIME '10:00', 30, 'confirmed', NULL),
    (v_doctor_3, v_svc_revision, 'Diego Castro Núñez',      '+34633300004',  3, TIME '14:30', 30, 'confirmed', NULL)
  ) AS a(
    doctor_id, service_id, patient_name, patient_phone,
    day_offset, start_t, duration, status, color
  );

  RAISE NOTICE 'Demo seed completed: 3 doctors, 4 services, 18 appointments, 2 exceptions.';
END $$;

COMMIT;

-- =============================================================
-- POST-RUN VERIFICATION (uncomment to inspect)
-- =============================================================
-- SELECT d.name AS doctor,
--        COUNT(*) FILTER (WHERE a.status = 'confirmed') AS confirmed,
--        COUNT(*) FILTER (WHERE a.status = 'cancelled') AS cancelled
--   FROM public.doctors d
--   LEFT JOIN public.appointments a ON a.doctor_id = d.id AND a.notes LIKE 'DEMO_SEED%'
--  WHERE d.email LIKE '%@demo.local'
--  GROUP BY d.name
--  ORDER BY d.name;
