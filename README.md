# Medical Booking Boilerplate

White-label patient booking system. OTP-verified appointments, GDPR-compliant, zero race conditions.

**Stack:** Next.js 15 (App Router) · Supabase (PostgreSQL + Auth + RLS) · Twilio SMS · Upstash Redis · shadcn/ui · Vercel

---

## Database Setup

### Deployment Model: Single-Tenant (one Supabase project per clinic)

Each clinic deployment is an isolated Supabase project. This gives each clinic their own database, auth namespace, and API keys — zero data leakage between tenants. No code changes are needed between deployments: only environment variables change.

```
Clinic A → Supabase project A → vercel-clinic-a.vercel.app
Clinic B → Supabase project B → vercel-clinic-b.vercel.app
```

### Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Note the **Project URL**, **anon key**, and **service_role key** from Settings → API

### Step 2 — Apply the schema

**Option A — Supabase CLI (recommended for automation)**

```bash
# Link to your project
npx supabase link --project-ref <your-project-ref>

# Push all migrations (applies 001_initial.sql, 002_add_phone_constraint.sql)
npx supabase db push
```

**Option B — Single consolidated file (simplest for new projects)**

Open Supabase Dashboard → SQL Editor → paste and run:

```
supabase/migrations/20260515000000_initial_schema.sql
```

This consolidated file contains the full schema (tables, indexes, triggers, RPCs, RLS, grants) plus sample seed data for a `clinica-prueba` clinic.

> **Do not run the consolidated file if migrations 001 + 002 are already applied** — you will get duplicate object errors.

### Step 3 — Create the first admin user

1. Go to Supabase Dashboard → **Authentication** → **Add user**
2. Enter the admin email (e.g. `studiogxa@gmail.com`) and a temporary password
3. The database trigger `fn_handle_new_user` automatically creates a `profiles` row for the new user

> Alternatively, the admin can self-register via the app at `/auth/login`.

### Step 4 — Link the admin to the clinic

The admin–clinic relationship is stored in `profiles.clinic_id` (not as an `admin_id` column in `clinics` — this design allows multiple admins/staff per clinic).

**Option A — SQL (after user exists in auth.users)**

```sql
UPDATE public.profiles
SET    clinic_id = (SELECT id FROM public.clinics WHERE slug = 'clinica-prueba'),
       role      = 'admin'
WHERE  id = (SELECT id FROM auth.users WHERE email = 'studiogxa@gmail.com');
```

**Option B — Admin Dashboard**

The admin panel at `/admin` provides a UI to assign themselves to a clinic after first login.

### Step 5 — Verify

```sql
-- Should return 1 row with clinic name and admin email
SELECT p.role, u.email, c.name AS clinic, c.slug
FROM   public.profiles p
JOIN   auth.users      u ON u.id = p.id
JOIN   public.clinics  c ON c.id = p.clinic_id
WHERE  u.email = 'studiogxa@gmail.com';
```

The booking page is live at: `https://your-domain.vercel.app/clinica-prueba`

---

## Full Deployment Guide (new tenant from zero)

### 1 — Clone & install

```bash
git clone https://github.com/GXA-Studio/medical-booking-boilerplate.git
cd medical-booking-boilerplate
npm install
```

### 2 — Configure environment variables

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp .env.example .env.local
```

| Variable | Description | Visibility |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Public (browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Public (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key — bypasses RLS | **Server only** |
| `SUPABASE_PROJECT_ID` | Project ref — only for `npm run db:types` | Local dev |
| `TWILIO_ACCOUNT_SID` | Twilio account SID | **Server only** |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | **Server only** |
| `TWILIO_PHONE_NUMBER` | Twilio sender number (E.164, e.g. `+19789724214`) | **Server only** |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | **Server only** |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token | **Server only** |
| `OTP_HASH_PEPPER` | 32-byte random hex — hardens SHA-256 OTP hashes | **Server only** |
| `NEXT_PUBLIC_APP_URL` | Public base URL (e.g. `https://clinica-a.vercel.app`) | Public |

Generate a pepper: `openssl rand -hex 32`

### 3 — Apply database schema

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### 4 — Regenerate TypeScript types (after schema changes)

```bash
npm run db:types
```

### 5 — Run locally

```bash
npm run dev
# → http://localhost:3000
```

### 6 — Deploy to Vercel

```bash
# First time
npx vercel link
# Upload each secret (repeat for all variables)
echo "value" | npx vercel env add VARIABLE_NAME production
npx vercel --prod

# Subsequent deploys — push to main, Vercel auto-deploys via GitHub integration
git push origin main
```

---

## Running E2E Tests

Tests use Playwright + a fixture page (`/test-fixture`) with static data — no database or Twilio required.

```bash
# Install browsers (first time)
npx playwright install chromium

# Local — starts dev server automatically
npx playwright test

# Against Vercel production
PLAYWRIGHT_BASE_URL=https://medical-booking-boilerplate.vercel.app npx playwright test
```

All 9 tests cover: service selection → doctor → slot (2-click: pick + confirm) → GDPR checkbox gate → OTP entry → confirmed screen.

---

## Architecture Highlights

| Feature | Implementation |
|---|---|
| Double-booking prevention | PostgreSQL `EXCLUDE USING gist` — race-condition proof at DB level |
| OTP security | SHA-256 + pepper, 5-minute TTL, CSPRNG, cleared after confirmation |
| Rate limiting | Upstash Redis via `@upstash/ratelimit` on `/api/otp/send` |
| Multi-tenant routing | `clinics.slug` drives `/[clinicSlug]` — no code changes between tenants |
| Patient privacy | Patients never create accounts; all writes via `SECURITY DEFINER` RPCs |
| Admin access | Row-Level Security; profiles link users to their clinic |

See [CONTEXT.md](CONTEXT.md) for full architectural decisions, schema documentation, and RPC function specs.
