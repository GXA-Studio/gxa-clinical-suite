-- Migration: B-4 (enum cleanup) + S-4 partial (trigger/RPC search_path) + B-6 (atomic doctor RPC)
--                                                                                  + D-10 (drop dead OTP index)
--
-- B-4 — Rebuild appointment_status without the legacy 'pending' value. The
--       column has *six* dependants whose definitions embed appointment_status
--       literals: the EXCLUDE constraint, the CHECK constraint, the column
--       default, and the three partial indexes idx_appt_doctor_time,
--       idx_appt_otp_expiry, idx_appt_reminder. ALTER COLUMN TYPE refuses to
--       rebuild dependents whose predicates compare two different types
--       ("text = appointment_status"), so we tear them all down, swap the
--       type, then rebuild every dependant except idx_appt_otp_expiry — which
--       is dead code (D-10): its WHERE clause references 'pending', a value
--       no longer reachable since 20260516_remove_pending_status.sql.
-- S-4 — Add SET search_path to every public function that still lacks it:
--       get_active_dow_for_service (SECURITY DEFINER, missed earlier), and
--       defense-in-depth on the two SECURITY INVOKER trigger functions
--       (fn_set_updated_at, fn_check_schedule_overlap).
-- B-6 — update_doctor_with_services bundles the DELETE-then-INSERT on
--       doctor_services into a single transactional function, closing the
--       window where the booking wizard could observe a doctor with no
--       services between the two PostgREST round-trips.

-- ─── 1. Tear down all dependants of appointments.status ───────────────────
ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_doctor_id_tstzrange_excl;

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS chk_appointments_status;

DROP INDEX IF EXISTS public.idx_appt_doctor_time;
DROP INDEX IF EXISTS public.idx_appt_otp_expiry;
DROP INDEX IF EXISTS public.idx_appt_reminder;

ALTER TABLE public.appointments
  ALTER COLUMN status DROP DEFAULT;

-- ─── 2. Rebuild the enum without 'pending' via text bridge ────────────────
ALTER TABLE public.appointments
  ALTER COLUMN status TYPE text USING status::text;

DROP TYPE public.appointment_status;

CREATE TYPE public.appointment_status AS ENUM ('confirmed', 'cancelled');

ALTER TABLE public.appointments
  ALTER COLUMN status TYPE public.appointment_status
    USING status::public.appointment_status;

ALTER TABLE public.appointments
  ALTER COLUMN status SET DEFAULT 'confirmed';

-- ─── 3. Restore live dependants (skip dead idx_appt_otp_expiry — D-10) ────
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_doctor_id_tstzrange_excl
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status <> 'cancelled');

CREATE INDEX idx_appt_doctor_time
  ON public.appointments USING btree (doctor_id, starts_at)
  WHERE (status <> 'cancelled');

CREATE INDEX idx_appt_reminder
  ON public.appointments USING btree (starts_at, reminder_sent)
  WHERE (status = 'confirmed' AND reminder_sent = false);

-- ─── 4. Harden remaining SECURITY DEFINER without search_path ─────────────
ALTER FUNCTION public.get_active_dow_for_service(uuid)
  SET search_path = pg_catalog, public;

-- ─── 5. Defense-in-depth on trigger functions (SECURITY INVOKER) ──────────
ALTER FUNCTION public.fn_set_updated_at()
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.fn_check_schedule_overlap()
  SET search_path = pg_catalog, public;

-- ─── 6. B-6 — Atomic doctor↔services update RPC ───────────────────────────
-- Runs as SECURITY INVOKER so RLS on doctor_services (admin-of-clinic only)
-- continues to enforce ownership. PostgreSQL functions are inherently
-- transactional, so the DELETE + bulk INSERT either both commit or both
-- roll back — there is no longer an instant where a doctor has no services.
CREATE OR REPLACE FUNCTION public.update_doctor_with_services(
  p_doctor_id   uuid,
  p_service_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.doctor_services
  WHERE doctor_id = p_doctor_id;

  IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) IS NOT NULL THEN
    INSERT INTO public.doctor_services (doctor_id, service_id)
    SELECT p_doctor_id, sid
    FROM   unnest(p_service_ids) AS sid;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_doctor_with_services(uuid, uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_doctor_with_services(uuid, uuid[]) TO authenticated;
