-- Migration: Perf + Schema cleanup (P-1 + P-6 + D-5 + D-6)
--
-- P-1 — Both slot RPCs are rewritten to compute the conflict set once via
--       CTEs (full_day_off, custom_windows, effective_windows, partial_blocks,
--       same_day_appts, candidate_slots) and then filter slots with NOT EXISTS
--       against those in-memory sets, replacing the previous per-slot EXISTS
--       pair against the live appointments + doctor_schedule_exceptions tables.
--       For a busy day (≥ 20 candidate slots × multiple doctors) this cuts the
--       work from O(slots × log(appointments)) per RPC call to a couple of
--       hash/nested joins over small CTE outputs.
-- P-6 — Admin "Citas" sorts by starts_at DESC. PG can back-scan the existing
--       (clinic_id, status, starts_at) ASC index but a DESC variant lets the
--       planner stream rows in target order without a Sort node.
-- D-5 — Booking pages query `public.clinics` with the anon role; the policy
--       was created directly in prod but never persisted to migrations. This
--       commits the schema drift back into the repo.
-- D-6 — `services.color` and `appointments.color` had no DB-side guard, only
--       the Zod schema in Server Actions. A direct UPDATE could insert any
--       string. Adding the CHECK enforces the same allow-list at the table.

-- ─── D-5: public read on clinics (drift recovery) ─────────────────────────
DROP POLICY IF EXISTS "public_read_clinics" ON public.clinics;
CREATE POLICY "public_read_clinics" ON public.clinics
  FOR SELECT
  USING (true);

-- ─── D-6: color allow-list as DB constraints ──────────────────────────────
ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_color_check;
ALTER TABLE public.services
  ADD CONSTRAINT services_color_check
  CHECK (color IN ('blue', 'emerald', 'purple', 'amber', 'rose'));

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_color_check;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_color_check
  CHECK (color IS NULL OR color IN ('blue', 'emerald', 'purple', 'amber', 'rose'));

-- ─── P-6: descending starts_at index for the admin Citas listing ──────────
CREATE INDEX IF NOT EXISTS idx_appt_clinic_status_starts_desc
  ON public.appointments (clinic_id, status, starts_at DESC);

-- ─── P-1: get_available_slots — CTE rewrite ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id  uuid,
  p_service_id uuid,
  p_date       date
)
RETURNS TABLE (slot_start timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_duration INTEGER;
  v_timezone TEXT;
  v_interval INTERVAL;
  v_dow      SMALLINT;
BEGIN
  SELECT svc.duration_minutes INTO v_duration
  FROM   public.services svc
  WHERE  svc.id = p_service_id AND svc.is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id
      USING ERRCODE = 'P0003';
  END IF;

  SELECT c.timezone INTO v_timezone
  FROM   public.clinics c
  JOIN   public.doctors d ON d.clinic_id = c.id
  WHERE  d.id = p_doctor_id AND d.is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doctor % not found or inactive', p_doctor_id
      USING ERRCODE = 'P0004';
  END IF;

  v_interval := v_duration * INTERVAL '1 minute';
  v_dow      := EXTRACT(DOW FROM p_date)::SMALLINT;

  RETURN QUERY
  WITH
  full_day_off AS (
    SELECT 1
    FROM   public.doctor_schedule_exceptions ex
    WHERE  ex.doctor_id      = p_doctor_id
      AND  ex.exception_date = p_date
      AND  ex.is_working     = FALSE
      AND  ex.start_time     IS NULL
  ),
  custom_windows AS (
    SELECT ex.start_time, ex.end_time
    FROM   public.doctor_schedule_exceptions ex
    WHERE  ex.doctor_id      = p_doctor_id
      AND  ex.exception_date = p_date
      AND  ex.is_working     = TRUE
  ),
  effective_windows AS (
    SELECT cw.start_time, cw.end_time
    FROM   custom_windows cw
    WHERE  NOT EXISTS (SELECT 1 FROM full_day_off)
    UNION ALL
    SELECT sch.start_time, sch.end_time
    FROM   public.schedules sch
    WHERE  sch.doctor_id   = p_doctor_id
      AND  sch.day_of_week = v_dow
      AND  sch.is_active   = TRUE
      AND  NOT EXISTS (SELECT 1 FROM custom_windows)
      AND  NOT EXISTS (SELECT 1 FROM full_day_off)
  ),
  partial_blocks AS (
    SELECT tstzrange(
             timezone(v_timezone, (p_date + ex.start_time)::TIMESTAMP),
             timezone(v_timezone, (p_date + ex.end_time  )::TIMESTAMP),
             '[)'
           ) AS range_
    FROM   public.doctor_schedule_exceptions ex
    WHERE  ex.doctor_id      = p_doctor_id
      AND  ex.exception_date = p_date
      AND  ex.is_working     = FALSE
      AND  ex.start_time     IS NOT NULL
  ),
  same_day_appts AS (
    SELECT tstzrange(a.starts_at, a.ends_at, '[)') AS range_
    FROM   public.appointments a
    WHERE  a.doctor_id = p_doctor_id
      AND  a.status   <> 'cancelled'
      AND  a.starts_at < ((p_date + INTERVAL '2 day')::TIMESTAMP AT TIME ZONE v_timezone)
      AND  a.ends_at   > ((p_date - INTERVAL '1 day')::TIMESTAMP AT TIME ZONE v_timezone)
  ),
  candidate_slots AS (
    SELECT gs AS slot_start
    FROM   effective_windows ew,
    LATERAL generate_series(
      timezone(v_timezone, (p_date + ew.start_time)::TIMESTAMP),
      timezone(v_timezone, (p_date + ew.end_time  )::TIMESTAMP) - v_interval,
      v_interval
    ) gs
  )
  SELECT cs.slot_start
  FROM   candidate_slots cs
  WHERE  cs.slot_start >= NOW()
    AND  NOT EXISTS (
      SELECT 1 FROM same_day_appts a
      WHERE  a.range_ && tstzrange(cs.slot_start, cs.slot_start + v_interval, '[)')
    )
    AND  NOT EXISTS (
      SELECT 1 FROM partial_blocks pb
      WHERE  pb.range_ && tstzrange(cs.slot_start, cs.slot_start + v_interval, '[)')
    )
  ORDER  BY cs.slot_start;
END;
$$;

-- ─── P-1: get_slots_for_service — CTE rewrite ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_slots_for_service(
  p_service_id uuid,
  p_date       date
)
RETURNS TABLE (
  slot_start       timestamptz,
  doctor_id        uuid,
  doctor_name      text,
  doctor_specialty text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_duration INTEGER;
  v_interval INTERVAL;
  v_dow      SMALLINT;
BEGIN
  SELECT svc.duration_minutes INTO v_duration
  FROM   public.services svc
  WHERE  svc.id = p_service_id AND svc.is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id
      USING ERRCODE = 'P0003';
  END IF;

  v_interval := v_duration * INTERVAL '1 minute';
  v_dow      := EXTRACT(DOW FROM p_date)::SMALLINT;

  RETURN QUERY
  WITH
  service_doctors AS (
    SELECT d.id AS doctor_id, d.name, d.specialty, c.timezone
    FROM   public.doctors         d
    JOIN   public.clinics         c  ON c.id        = d.clinic_id
    JOIN   public.doctor_services ds ON ds.doctor_id = d.id
    WHERE  ds.service_id = p_service_id
      AND  d.is_active   = TRUE
  ),
  full_day_off AS (
    SELECT ex.doctor_id
    FROM   public.doctor_schedule_exceptions ex
    WHERE  ex.exception_date = p_date
      AND  ex.is_working     = FALSE
      AND  ex.start_time     IS NULL
  ),
  custom_windows AS (
    SELECT ex.doctor_id, ex.start_time, ex.end_time
    FROM   public.doctor_schedule_exceptions ex
    WHERE  ex.exception_date = p_date
      AND  ex.is_working     = TRUE
  ),
  effective_windows AS (
    SELECT sd.doctor_id, sd.name, sd.specialty, sd.timezone,
           cw.start_time, cw.end_time
    FROM   service_doctors sd
    JOIN   custom_windows cw ON cw.doctor_id = sd.doctor_id
    WHERE  NOT EXISTS (SELECT 1 FROM full_day_off fdo WHERE fdo.doctor_id = sd.doctor_id)
    UNION ALL
    SELECT sd.doctor_id, sd.name, sd.specialty, sd.timezone,
           sch.start_time, sch.end_time
    FROM   service_doctors sd
    JOIN   public.schedules sch
      ON   sch.doctor_id   = sd.doctor_id
      AND  sch.day_of_week = v_dow
      AND  sch.is_active   = TRUE
    WHERE  NOT EXISTS (SELECT 1 FROM custom_windows cw WHERE cw.doctor_id = sd.doctor_id)
      AND  NOT EXISTS (SELECT 1 FROM full_day_off    fdo WHERE fdo.doctor_id = sd.doctor_id)
  ),
  partial_blocks AS (
    SELECT
      ex.doctor_id,
      tstzrange(
        timezone(sd.timezone, (p_date + ex.start_time)::TIMESTAMP),
        timezone(sd.timezone, (p_date + ex.end_time  )::TIMESTAMP),
        '[)'
      ) AS range_
    FROM   public.doctor_schedule_exceptions ex
    JOIN   service_doctors sd ON sd.doctor_id = ex.doctor_id
    WHERE  ex.exception_date = p_date
      AND  ex.is_working     = FALSE
      AND  ex.start_time     IS NOT NULL
  ),
  same_day_appts AS (
    SELECT a.doctor_id, tstzrange(a.starts_at, a.ends_at, '[)') AS range_
    FROM   public.appointments a
    JOIN   service_doctors sd ON sd.doctor_id = a.doctor_id
    WHERE  a.status <> 'cancelled'
      AND  a.starts_at < ((p_date + INTERVAL '2 day')::TIMESTAMP AT TIME ZONE sd.timezone)
      AND  a.ends_at   > ((p_date - INTERVAL '1 day')::TIMESTAMP AT TIME ZONE sd.timezone)
  ),
  candidate_slots AS (
    SELECT
      ew.doctor_id, ew.name AS doctor_name, ew.specialty AS doctor_specialty,
      gs AS slot_start
    FROM   effective_windows ew,
    LATERAL generate_series(
      timezone(ew.timezone, (p_date + ew.start_time)::TIMESTAMP),
      timezone(ew.timezone, (p_date + ew.end_time  )::TIMESTAMP) - v_interval,
      v_interval
    ) gs
  )
  SELECT cs.slot_start, cs.doctor_id, cs.doctor_name, cs.doctor_specialty
  FROM   candidate_slots cs
  WHERE  cs.slot_start >= NOW()
    AND  NOT EXISTS (
      SELECT 1 FROM same_day_appts a
      WHERE  a.doctor_id = cs.doctor_id
        AND  a.range_ && tstzrange(cs.slot_start, cs.slot_start + v_interval, '[)')
    )
    AND  NOT EXISTS (
      SELECT 1 FROM partial_blocks pb
      WHERE  pb.doctor_id = cs.doctor_id
        AND  pb.range_ && tstzrange(cs.slot_start, cs.slot_start + v_interval, '[)')
    )
  ORDER  BY cs.doctor_name, cs.slot_start;
END;
$$;
