-- ================================================================
-- Medical Booking Boilerplate — Reschedule Appointment RPC
-- File   : 20260515200000_reschedule_rpc.sql
-- ================================================================
-- Adds the reschedule_appointment function used by the /manage/[token]
-- patient portal to atomically move an appointment to a new slot.
--
-- SAFETY MODEL
-- The existing EXCLUDE USING gist constraint on appointments is the
-- primary double-booking guard. By performing a single UPDATE (not a
-- cancel-then-insert), the constraint fires atomically: if the new
-- slot overlaps any other confirmed appointment for that doctor,
-- PostgreSQL raises SQLSTATE 23P01 (exclusion_violation) before the
-- UPDATE is committed.
-- ================================================================

CREATE OR REPLACE FUNCTION public.reschedule_appointment(
  p_cancellation_token UUID,
  p_new_doctor_id      UUID,
  p_new_starts_at      TIMESTAMPTZ
)
RETURNS public.appointments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_appt        public.appointments;
  v_duration    INTEGER;
  v_new_ends_at TIMESTAMPTZ;
BEGIN
  -- Lock the row so concurrent reschedule calls on the same token are serialised
  SELECT * INTO v_appt
  FROM   public.appointments
  WHERE  cancellation_token = p_cancellation_token
    AND  status             = 'confirmed'
    AND  starts_at          > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found, already cancelled, or in the past'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_new_starts_at <= NOW() THEN
    RAISE EXCEPTION 'New slot must be in the future'
      USING ERRCODE = 'P0004';
  END IF;

  -- Derive end time from the original service duration (service cannot change)
  SELECT duration_minutes INTO v_duration
  FROM   public.services
  WHERE  id = v_appt.service_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found or inactive'
      USING ERRCODE = 'P0003';
  END IF;

  v_new_ends_at := p_new_starts_at + (v_duration * INTERVAL '1 minute');

  -- Atomic reschedule: single UPDATE so the GIST EXCLUDE fires if the new
  -- slot conflicts with any OTHER confirmed appointment for the target doctor.
  -- The old time range is replaced in the same statement, so it is freed atomically.
  UPDATE public.appointments
  SET    doctor_id = p_new_doctor_id,
         starts_at = p_new_starts_at,
         ends_at   = v_new_ends_at
  WHERE  id = v_appt.id
  RETURNING * INTO v_appt;

  RETURN v_appt;

EXCEPTION
  WHEN exclusion_violation THEN  -- SQLSTATE 23P01
    RAISE EXCEPTION 'SLOT_TAKEN'
      USING ERRCODE = 'P0001',
            DETAIL  = 'The new slot is already taken by another confirmed appointment';
END;
$$;

-- Only callable from the service-role key (used by server-side Route Handlers)
GRANT EXECUTE ON FUNCTION public.reschedule_appointment TO service_role;
