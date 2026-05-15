-- Migration: Remove 'pending' appointment status
-- All bookings are immediately confirmed (direct booking, no OTP gate).

-- 1. Backfill: any lingering pending rows → confirmed
UPDATE appointments
SET    status = 'confirmed'
WHERE  status = 'pending';

-- 2. Add a CHECK constraint so the DB enforces the two-value domain
--    (We keep the underlying enum for backwards compat with existing RPCs,
--     but the constraint makes 'pending' physically impossible to insert.)
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS chk_appointments_status;

ALTER TABLE appointments
  ADD  CONSTRAINT chk_appointments_status
  CHECK (status IN ('confirmed', 'cancelled'));

-- 3. Change the column default from 'pending' to 'confirmed'
ALTER TABLE appointments
  ALTER COLUMN status SET DEFAULT 'confirmed';
