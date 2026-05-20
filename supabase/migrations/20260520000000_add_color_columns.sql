-- Color categorization for admin agenda view
-- services.color: default color for all appointments of this service type
-- appointments.color: per-appointment override (NULL = inherit from service)
ALTER TABLE services     ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT 'blue';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS color text;
