-- =============================================================
-- Migration: Service-first slot lookup (Time-First UX flow)
-- =============================================================

-- get_slots_for_service
-- Returns all free (slot_start, doctor) combinations for a given
-- service + local calendar date. Used by the Time-First booking flow
-- where the patient selects a time before choosing a doctor.
--
-- Same booking-conflict logic as get_available_slots: a slot is
-- occupied when a confirmed OR still-valid-pending appointment
-- overlaps it for that doctor.
CREATE OR REPLACE FUNCTION public.get_slots_for_service(
  p_service_id UUID,
  p_date       DATE
)
RETURNS TABLE (
  slot_start       TIMESTAMPTZ,
  doctor_id        UUID,
  doctor_name      TEXT,
  doctor_specialty TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_duration   INTEGER;
  v_interval   INTERVAL;
  v_dow        SMALLINT;
  r_doc        RECORD;
  r_sched      RECORD;
  v_win_start  TIMESTAMPTZ;
  v_win_end    TIMESTAMPTZ;
  v_cursor     TIMESTAMPTZ;
  v_slot_end   TIMESTAMPTZ;
BEGIN
  SELECT duration_minutes INTO v_duration
  FROM   public.services
  WHERE  id = p_service_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service % not found or inactive', p_service_id
      USING ERRCODE = 'P0003';
  END IF;

  v_interval := v_duration * INTERVAL '1 minute';
  v_dow      := EXTRACT(DOW FROM p_date)::SMALLINT;

  FOR r_doc IN
    SELECT d.id, d.name, d.specialty, c.timezone
    FROM   public.doctors         d
    JOIN   public.clinics         c  ON c.id        = d.clinic_id
    JOIN   public.doctor_services ds ON ds.doctor_id = d.id
    WHERE  ds.service_id = p_service_id
      AND  d.is_active   = TRUE
    ORDER  BY d.name
  LOOP
    FOR r_sched IN
      SELECT *
      FROM   public.schedules
      WHERE  doctor_id   = r_doc.id
        AND  day_of_week = v_dow
        AND  is_active   = TRUE
      ORDER  BY start_time
    LOOP
      v_win_start := timezone(r_doc.timezone, (p_date + r_sched.start_time)::TIMESTAMP);
      v_win_end   := timezone(r_doc.timezone, (p_date + r_sched.end_time)::TIMESTAMP);
      v_cursor    := v_win_start;

      WHILE v_cursor + v_interval <= v_win_end LOOP
        v_slot_end := v_cursor + v_interval;

        IF NOT EXISTS (
          SELECT 1
          FROM   public.appointments
          WHERE  doctor_id = r_doc.id
            AND  status   <> 'cancelled'
            AND (
                  status = 'confirmed'
              OR (status = 'pending' AND otp_expires_at > NOW())
                )
            AND  tstzrange(starts_at, ends_at, '[)') &&
                 tstzrange(v_cursor, v_slot_end, '[)')
        ) THEN
          slot_start       := v_cursor;
          doctor_id        := r_doc.id;
          doctor_name      := r_doc.name;
          doctor_specialty := r_doc.specialty;
          RETURN NEXT;
        END IF;

        v_cursor := v_slot_end;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_slots_for_service TO anon, authenticated;


-- get_active_dow_for_service
-- Returns the distinct days-of-week (0=Sun … 6=Sat) where at least
-- one active doctor offering this service has an active schedule block.
-- Used to disable calendar days that can never have slots.
CREATE OR REPLACE FUNCTION public.get_active_dow_for_service(
  p_service_id UUID
)
RETURNS TABLE (day_of_week SMALLINT)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT DISTINCT s.day_of_week
  FROM   public.schedules       s
  JOIN   public.doctor_services ds ON ds.doctor_id = s.doctor_id
  JOIN   public.doctors         d  ON d.id         = s.doctor_id
  WHERE  ds.service_id = p_service_id
    AND  s.is_active   = TRUE
    AND  d.is_active   = TRUE
  ORDER  BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_dow_for_service TO anon, authenticated;
