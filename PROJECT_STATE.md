# PROJECT STATE — Medical Booking Boilerplate · Pipeline Técnico
> **Single source of truth técnico** para todas las sesiones futuras.  
> Última actualización: **2026-05-23** — Ultra-Review audit completo: security (S-1–S-10), logic (B-1–B-9), performance (P-1, P-5, P-6), tech-debt (D-1–D-12). Sin deuda técnica crítica pendiente.  
> Para perspectiva de producto y flujos funcionales, ver **`CLINIC_PRODUCT_STATE.md`**.

---

## 1. Tech Stack

| Capa | Tecnología | Detalles |
|---|---|---|
| Framework | Next.js 15 (App Router) | TypeScript strict, React 19 |
| Base de datos | Supabase (PostgreSQL 15+) | Auth + DB + RLS + SECURITY DEFINER RPCs |
| Hosting | Vercel | Serverless Edge/Node.js Route Handlers; `after()` para tareas deferidas |
| Mensajería saliente | Twilio WhatsApp | Sandbox: `whatsapp:+14155238886` — reemplazar por número aprobado en prod |
| Mensajería entrante | Twilio Webhook | `POST /api/webhooks/whatsapp` — IA conversacional (cancelar / modificar / info) |
| Status callbacks | Twilio Webhook | `POST /api/webhooks/twilio` — observabilidad de entregabilidad |
| Email transaccional | Nodemailer + Gmail App Password | Solo para leads internos GXA Studio |
| UI | shadcn/ui + Tailwind CSS | framer-motion para animaciones de pasos |
| Cache / Rate-limit | Upstash Redis | 4 limiters activos — ver §4 |
| Validación | Zod | Todos los Route Handlers públicos + Server Actions |
| Fechas | date-fns v4 + date-fns-tz | `date-fns` para aritmética; `date-fns-tz` para conversión IANA (DST-safe) |

---

## 2. Base de Datos — Esquema Completo

### 2.1 Tablas

```
clinics
  id              UUID PK
  name            TEXT NOT NULL
  slug            TEXT UNIQUE NOT NULL          -- URL pública de la clínica
  timezone        TEXT NOT NULL DEFAULT 'Europe/Madrid'
  phone           TEXT
  address         TEXT
  settings        JSONB
  legal_name      TEXT NULLABLE                 -- Razón social oficial (RGPD art.13)
  cif             TEXT NULLABLE                 -- NIF / CIF (RGPD art.13)
  updated_at      TIMESTAMPTZ

profiles
  id              UUID PK → auth.users(id)      -- 1:1 con auth.users
  clinic_id       UUID → clinics(id)
  full_name       TEXT
  role            TEXT CHECK IN ('admin','staff')
  created_at      TIMESTAMPTZ

services
  id              UUID PK
  clinic_id       UUID → clinics(id)
  name            TEXT NOT NULL
  duration_minutes INTEGER NOT NULL
  price           NUMERIC
  is_active       BOOLEAN DEFAULT true
  color           TEXT NOT NULL DEFAULT 'blue'   -- blue|emerald|purple|amber|rose

doctors
  id              UUID PK
  clinic_id       UUID → clinics(id)
  name            TEXT NOT NULL
  email           TEXT
  specialty       TEXT
  avatar_url      TEXT
  is_active       BOOLEAN DEFAULT true

doctor_services
  doctor_id       UUID → doctors(id) ON DELETE CASCADE
  service_id      UUID → services(id) ON DELETE CASCADE
  PRIMARY KEY (doctor_id, service_id)

insurances
  id              UUID PK
  name            TEXT UNIQUE NOT NULL           -- Privado, Adeslas, Sanitas, Mapfre, Asisa, DKV, Allianz
  logo_url        TEXT
  created_at      TIMESTAMPTZ
  RLS: public read (ins_public_read)

doctor_insurances
  doctor_id       UUID → doctors(id) ON DELETE CASCADE
  insurance_id    UUID → insurances(id) ON DELETE CASCADE
  PRIMARY KEY (doctor_id, insurance_id)
  RLS: public read (di_public_read)

schedules
  id              UUID PK
  doctor_id       UUID → doctors(id)
  day_of_week     SMALLINT 0-6 (0=dom)
  start_time      TIME NOT NULL
  end_time        TIME NOT NULL
  is_active       BOOLEAN DEFAULT true
  UNIQUE (doctor_id, day_of_week, start_time, end_time)

doctor_schedule_exceptions
  id              UUID PK
  doctor_id       UUID → doctors(id)
  exception_date  DATE NOT NULL
  is_working      BOOLEAN NOT NULL
  start_time      TIME NULLABLE
  end_time        TIME NULLABLE
  UNIQUE INDEX partial on (doctor_id, date, is_working, COALESCE(start_time,'00:00'), COALESCE(end_time,'00:00'))
  CHECK 3 formas válidas:
    (is_working=false, hours NULL)           → Día Completo Libre
    (is_working=false, hours NOT NULL)       → Bloqueo Parcial
    (is_working=true,  hours NOT NULL)       → Ventana Custom (legacy)

appointments
  id                  UUID PK
  clinic_id           UUID → clinics(id)
  doctor_id           UUID → doctors(id)
  service_id          UUID → services(id)
  patient_name        TEXT NOT NULL
  patient_phone       TEXT NOT NULL
  starts_at           TIMESTAMPTZ NOT NULL
  ends_at             TIMESTAMPTZ NOT NULL
  status              TEXT CHECK IN ('confirmed','cancelled')   -- 'pending' eliminado
  cancellation_token  UUID UNIQUE DEFAULT gen_random_uuid()
  reminder_sent       BOOLEAN NOT NULL DEFAULT false
  notes               TEXT
  color               TEXT NULLABLE                             -- override por cita; NULL = hereda services.color
  EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (status <> 'cancelled')                              -- anti-colisión atómica

marketing_leads                                                -- DOMINIO GXA STUDIO (no clínica)
  id          UUID PK
  created_at  TIMESTAMPTZ
  name        TEXT NOT NULL
  email       TEXT NOT NULL
  clinic      TEXT NOT NULL         -- texto libre "Clínica X — Valencia"
  message     TEXT
  source      TEXT NOT NULL DEFAULT 'landing'
  ip          TEXT
  user_agent  TEXT
  status      TEXT CHECK IN ('new','contacted','demo_scheduled','closed_won','closed_lost','spam')
  notes       TEXT
  RLS: deny-by-default (no policies). Acceso solo vía service_role.
```

**Columnas eliminadas de `appointments`**: `otp_code_hash`, `otp_expires_at` (migration `20260516_remove_pending_status.sql`).  
**`lib/supabase/types.ts`** regenerado vía `npm run db:types` — refleja el esquema actual (sin `admin_id`, con `marketing_leads`, `insurances`, `doctor_insurances`, RPCs actuales).

---

### 2.2 Índices

| Índice | Tabla | Columnas | Estado |
|---|---|---|---|
| `idx_clinics_slug` | clinics | `slug` | ✅ Activo |
| `idx_services_clinic_active` | services | `(clinic_id, is_active)` | ✅ Activo |
| `idx_doctors_clinic_active` | doctors | `(clinic_id, is_active)` | ✅ Activo |
| `idx_appointments_doctor_slots` | appointments | `(doctor_id, starts_at)` | ✅ Activo |
| `idx_appointments_clinic_starts` | appointments | `(clinic_id, status, starts_at)` | ✅ Activo |
| `idx_appt_patient_phone` | appointments | `patient_phone` btree (total) | ⚠️ Poco selectivo |
| `idx_appt_clinic_status_starts_desc` | appointments | `(clinic_id, status, starts_at DESC)` | ✅ Activo — P-6, cubre listados de admin |
| `marketing_leads_created_at_idx` | marketing_leads | `created_at DESC` | ✅ Activo |
| `marketing_leads_status_idx` | marketing_leads | `status` | ✅ Activo |
| `marketing_leads_email_idx` | marketing_leads | `email` | ✅ Activo |
| UNIQUE idx parcial en exceptions | doctor_schedule_exceptions | `(doctor_id, date, is_working, COALESCE(st,'00:00'), COALESCE(et,'00:00'))` | ✅ Activo |

---

### 2.3 RPCs Activas

Todas las SECURITY DEFINER tienen `SET search_path = pg_catalog, public` (fix S-4: RPCs públicas en `20260523000000`; trigger functions y `get_active_dow_for_service` en `20260523200000`).

| Función | Argumentos | Returns | Caller | Grant |
|---|---|---|---|---|
| `get_available_slots` | `(doctor_id, service_id, date)` | `TABLE(slot_start TIMESTAMPTZ)` | `/api/slots` | anon |
| `get_slots_for_service` | `(service_id, date)` | `TABLE(slot_start, doctor_id, doctor_name, doctor_specialty)` | `/api/slots` mode-B | anon |
| `book_slot_confirmed` | `(clinic_id, doctor_id, service_id, patient_name, patient_phone, starts_at)` | `appointments` | `/api/book`, `bookAppointmentManual` | anon |
| `reschedule_appointment` | `(cancellation_token, new_doctor_id, new_starts_at)` | `appointments` | `rescheduleAppointment` server action | service_role |

#### Pipeline de validación — `book_slot_confirmed`

```
1. doctor ∈ clinic + is_active          → P0006 DOCTOR_NOT_IN_CLINIC
2. doctor offers service                → P0007 DOCTOR_DOES_NOT_OFFER_SERVICE   (S-1)
3. service is_active (→ duration)       → P0003 SERVICE_NOT_FOUND
4. starts_at > NOW()                    → P0008 INVALID_OR_UNAVAILABLE_SLOT     (S-2)
5. No full-day-off exception            → P0008                                 (S-2)
6. No partial-block overlap             → P0008                                 (S-2)
7. Slot fits in working window          → P0008                                 (S-2)
8. INSERT → EXCLUDE constraint          → P0001 SLOT_TAKEN (carrera atómica)
```

#### Pipeline de validación — `reschedule_appointment`

```
1. SELECT FOR UPDATE (serializa llamadas concurrentes sobre el mismo token)
2. starts_at > NOW()                    → P0004
3. new_doctor ∈ original clinic         → P0009 CROSS_TENANT_VIOLATION         (S-3)
4. new_doctor offers original service   → P0010 INVALID_SERVICE_FOR_NEW_DOCTOR  (S-3)
5. service still active (→ duration)    → P0003
6. UPDATE → EXCLUDE constraint          → P0001 SLOT_TAKEN
```

---

### 2.4 Funciones de Trigger

| Función | Tipo | SECURITY DEFINER | search_path | Estado |
|---|---|---|---|---|
| `fn_handle_new_user()` | — | — | — | **N/A — no existe en la DB** (hallazgo ultra-review; función referenciada pero nunca creada) |
| `fn_set_updated_at()` | TRIGGER (before update on clinics) | ✅ | ✅ `pg_catalog, public` | ✅ Fijado en `20260523200000` |
| `fn_check_schedule_overlap()` | TRIGGER (before insert/update on schedules) | ✅ | ✅ `pg_catalog, public` | ✅ Fijado en `20260523200000` |

---

### 2.5 Migraciones — Lista Completa (20)

| Archivo | Contenido | Nota |
|---|---|---|
| `002_add_phone_constraint.sql` | Constraint E.164 en patient_phone | — |
| `003_whatsapp_instant_booking.sql` | `cancellation_token`, `reminder_sent`, `book_slot_confirmed` RPC (versión 1) | — |
| `20260515100000_slots_for_service.sql` | `get_slots_for_service` RPC (versión 1) | — |
| `20260515200000_reschedule_rpc.sql` | `reschedule_appointment` RPC (versión 1) | — |
| `20260515300000_security_patches.sql` | S-04 previo: doctor ∈ clinic en `book_slot_confirmed` | — |
| `20260515_final_schema.sql` | Schema completo + seed + triggers (CERTIFICADO, en prod) | — |
| `20260515_insurances.sql` | Tablas `insurances` + `doctor_insurances` + seed mutuas Spain | — |
| `20260515_perf_indexes.sql` | 5 índices B-Tree de rendimiento | — |
| `20260516_fix_get_slots_for_service.sql` | Fix en `get_slots_for_service` | — |
| `20260516_remove_pending_status.sql` | DROP status='pending' del CHECK; elimina columnas otp_* | — |
| `20260520000000_add_color_columns.sql` | `services.color` (DEFAULT 'blue') + `appointments.color` (NULLABLE) | — |
| `20260520100000_doctor_schedule_exceptions.sql` | Tabla `doctor_schedule_exceptions` + RPCs exception-aware | — |
| `20260520200000_partial_time_blocks.sql` | Bloqueos parciales múltiples por día; CHECK extendido a 3 formas | — |
| `20260520300000_filter_past_slots.sql` | RPCs filtran slots pasados (`v_cursor < NOW()`) | — |
| `20260522120000_marketing_leads.sql` | Tabla `marketing_leads` (dominio GXA Studio) | — |
| `20260522130000_clinic_legal_fields.sql` | `clinics.legal_name` + `clinics.cif` | — |
| `20260523000000_critical_security_patches.sql` | S-1 (P0007) + S-2 (P0008) + S-3 (P0009/P0010) + S-4 (`search_path` en 4 RPCs) | — |
| `20260523100000_drop_legacy_otp_rpcs.sql` | `DROP FUNCTION book_slot`, `DROP FUNCTION confirm_appointment` | — |
| `20260523200000_logic_fixes_and_enums.sql` | B-4 (enum rebuild appointment_status), S-4 extendido (fn triggers + get_active_dow), B-6 (`update_doctor_with_services` RPC atómica) | — |
| `20260523300000_perf_and_schema_cleanup.sql` | P-1 (CTE rewrite de slot RPCs), P-6 (idx_appt_clinic_status_starts_desc), D-5 (policy `public_read_clinics`), D-6 (CHECK constraints color) | **Última migración aplicada** |

---

## 3. Seguridad

### 3.1 Rate Limiting (Upstash Redis)

| Limiter | Prefijo | Ventana | Límite | Endpoint |
|---|---|---|---|---|
| `bookingIpLimiter` | `@mbb/booking:ip` | 1 h sliding | 10/IP | `POST /api/book` |
| `slotsLimiter` | `@mbb/slots:ip` | 1 min sliding | 60/IP | `GET /api/slots`, `/api/slots/week` |
| `leadsIpLimiter` | `@mbb/leads:ip` | 1 h sliding | 5/IP | `POST /api/leads` |
| `demoLimiter` | `@mbb/demo:ip` | 1 min sliding | 5/IP | `GET /admin/guest` |

Todos los limiters **fail open** (si Redis no está disponible, la petición pasa). El constructor Redis es lazy para evitar errores en build cuando las env vars están ausentes.

### 3.2 RLS y Roles

- **Admin**: opera solo sobre su `clinic_id` (extraído de `profiles` via `auth.uid()`).
- **anon**: puede ejecutar RPCs `get_available_slots`, `get_slots_for_service`, `book_slot_confirmed`.
- **service_role**: bypassa RLS; usado solo por `cancelByToken`, `cancelOverlappingAppointments` y `reschedule_appointment` RPC. `adminCancelAppointment` y `bookAppointmentManual` usan la sesión autenticada del admin (session client) — sin sobrelevantar a service_role (fix D-10).
- **marketing_leads**: RLS deny-by-default (sin políticas). Solo service_role vía `/api/leads`.
- **clinics (public read)**: policy `public_read_clinics` añadida en migración `20260523300000_perf_and_schema_cleanup.sql` — drift resuelto.

### 3.3 SECURITY DEFINER — search_path

Estado tras migraciones `20260523000000` + `20260523200000`:

| Función | search_path fijado |
|---|---|
| `get_available_slots` | ✅ `SET search_path = pg_catalog, public` |
| `get_slots_for_service` | ✅ |
| `book_slot_confirmed` | ✅ |
| `reschedule_appointment` | ✅ |
| `get_active_dow_for_service` | ✅ Fijado en `20260523200000` |
| `fn_handle_new_user` | **N/A** — función no existe en la DB |
| `fn_set_updated_at` | ✅ Fijado en `20260523200000` |
| `fn_check_schedule_overlap` | ✅ Fijado en `20260523200000` |

### 3.4 Autenticación Admin y Modo Demo

**Auth normal**: Supabase Auth (email + password). Middleware intercepta `/admin/*` sin sesión → redirige a `/auth/login`.

**Modo Demo** (`/admin/guest`):
- Rate-limit: `demoLimiter` (5/min IP).
- `signInWithPassword` con credenciales de la cuenta `admin@demo.com` (hardcoded — solo en deploys de demo).
- Cookie `mbb_guest=1`: `httpOnly: true`, `secure: true`, `sameSite: 'strict'`, `maxAge: 2h`.
- Detección en `lib/admin/guest-guard.ts`: double-check cookie + `user.email === DEMO_EMAIL`.
- Patrón `DEMO_RESULT`: todas las Server Actions mutadoras comprueban `isGuestMode()` como primera línea y retornan `{ demo: true }` sin tocar la BD.

### 3.5 Webhooks Twilio — Firma HMAC

Ambos endpoints (`/api/webhooks/whatsapp` y `/api/webhooks/twilio`) reconstruyen la URL de firma desde `x-forwarded-proto` + `x-forwarded-host` — **no** desde `NEXT_PUBLIC_APP_URL`. Esto evita que la verificación falle en deploy previews.

### 3.6 Validaciones de Input

- **UUID**: regex `/^[0-9a-f]{8}-…$/i` antes de cualquier query.
- **Phone**: solo E.164 (`/^\+[1-9]\d{7,14}$/`).
- **Name**: strip de caracteres de control (prevención SMS injection).
- **`server-only`**: importado en todos los módulos de servidor.
- **S-8**: `assertServicesBelongToClinic()` en `createDoctor`/`updateDoctor` verifica que los `service_id` pertenezcan a la misma clínica del admin antes de INSERT en `doctor_services`.

---

## 4. Variables de Entorno

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # SERVER-SIDE ONLY — nunca exponer al cliente
SUPABASE_PROJECT_ID=              # Solo para: npm run db:types

# Twilio
TWILIO_ACCOUNT_SID=               # AC...
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=              # E.164 — SMS/legacy (Twilio test: +15005550006)
TWILIO_WHATSAPP_FROM=             # WhatsApp sender (sandbox: whatsapp:+14155238886)

# App
NEXT_PUBLIC_APP_URL=              # e.g. https://medical-booking-boilerplate.vercel.app
NEXT_PUBLIC_DEFAULT_TIMEZONE=     # IANA fallback opcional, e.g. Europe/Madrid

# Gmail (leads pipeline — GXA Studio interno)
GMAIL_APP_USER=studiogxa@gmail.com
GMAIL_APP_PASSWORD=               # Gmail App Password (16 chars, Account → Security → 2FA → App passwords)

# Redis (Upstash)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Demo mode
DEMO_EMAIL=admin@demo.com         # Cuenta Supabase Auth para el modo demo

# Cron (cuando se active — ver §8)
CRON_SECRET=                      # 32-byte hex random (openssl rand -hex 32)
```

**Eliminado**: `OTP_HASH_PEPPER` — código OTP removido en `20260516_remove_pending_status.sql`; helpers JS borrados de `lib/utils.ts` y bloque eliminado del `.env.example` (commit `703bf3a`). Verificar que no quede definido en `.env.local` ni en Vercel Dashboard.

---

## 5. Arquitectura de Cache

| Capa | Clave | TTL | Invalidado por |
|---|---|---|---|
| Upstash (booking data) | `mbb:booking:v2:{slug}` | 5 min | `invalidateBookingCache(slug)` — llamado desde todas las mutations de servicios, médicos, horarios, seguros |
| Next.js `revalidatePath` | `/admin/{appointments,schedules,agenda,doctors,services}`, `/{clinicSlug}` | — | `bustSlotCaches(clinicSlug)` |
| HTTP `Cache-Control` | `/api/slots`, `/api/slots/week` | `no-store` | — Nunca cachear — excepciones cambian en tiempo real |
| HTTP `Cache-Control` | `/api/available-days` | `private, max-age=300` | Devuelve solo `day_of_week` estructural — insensible a excepciones puntuales |

`bustSlotCaches(clinicSlug)` es el punto único de invalidación: llama a `revalidatePath` (múltiples rutas) + `invalidateBookingCache` (Redis). Se invoca desde todas las Server Actions de horarios, médicos y servicios.

---

## 6. Invariantes Técnicos — NO Romper

### 6.1 DST y Zona Horaria

Las RPCs `get_available_slots` y `get_slots_for_service` son DST-safe:

```sql
v_win_start := timezone(v_timezone, (p_date + r_sched.start_time)::TIMESTAMP);
v_win_end   := timezone(v_timezone, (p_date + r_sched.end_time)::TIMESTAMP);
```

`timezone(zone, TIMESTAMP)` consulta la base IANA para la fecha concreta. **Nunca usar `AT TIME ZONE` sobre `TIMESTAMPTZ` como input ni añadir offsets hardcodeados.**

### 6.2 Slot RPCs — Reglas de Excepciones (3 pasos por doctor)

```
1. ¿Existe fila (is_working=false, start_time IS NULL)?
   → SÍ: 0 slots (día libre). RETURN / CONTINUE.

2. ¿Existen filas (is_working=true)?  (ventana custom legacy)
   → SÍ: usar esas filas como ventanas en lugar del horario semanal.
   → NO: usar schedules por day_of_week.

3. Para cada slot generado:
   - Saltar si solapa con appointment activa.
   - Saltar si solapa con fila (is_working=false, start_time NOT NULL)  → bloqueo parcial.
```

El chequeo de día libre debe ir **antes** de generar slots. El overlap usa `tstzrange('[)')` — bordes exclusivos en el extremo superior.

### 6.3 Paginación Semanal — Fechas Locales

`parseISO('YYYY-MM-DD')` en date-fns v4 devuelve medianoche local (no UTC). Usar `format(addDays(...), 'yyyy-MM-dd')` para navegar semanas. **Nunca** `.toISOString().slice(0,10)` sobre un resultado de `parseISO` en zonas UTC+.

```typescript
// ✅ Correcto
format(addDays(parseISO(filters.date), 7), 'yyyy-MM-dd')

// ❌ Roto en UTC+ (pierde el offset, puede dar ayer)
addDays(parseISO(filters.date), 7).toISOString().slice(0, 10)
```

### 6.4 Color de Citas — Tailwind Purge

Las tarjetas de agenda usan un diccionario estático `APPOINTMENT_COLORS` (`lib/constants/colors.ts`). **Nunca interpolar nombres de clase dinámicamente** (ej. `` `bg-${color}-50` ``). Todos los valores deben aparecer verbatim en el código.

Colores válidos: `blue | emerald | purple | amber | rose`. Las citas pasadas siempre muestran `slate`.

### 6.5 HTTP Cache — no-store en slots

`/api/slots` y `/api/slots/week` deben mantener `Cache-Control: no-store`. Un cambio a `public, max-age=N` enmascara bloqueos recién creados durante N segundos (bug ya vivido y resuelto).

### 6.6 Modo Demo — DEMO_RESULT

Todas las Server Actions mutadoras deben comprobar `isGuestMode()` como **primera línea**. Nunca dejar pasar una mutación sin este check en el dominio `/admin/`.

### 6.7 Excepciones de horario — orden de persistencia (mitigación B-1)

`createScheduleException` debe persistir la excepción en `doctor_schedule_exceptions` **antes** de invocar `cancelOverlappingAppointments`. Desde el INSERT, `get_available_slots` / `book_slot_confirmed` rechazan nuevas reservas dentro de la ventana (P0008), cerrando estructuralmente la race condition entre el `AlertDialog` de conflictos y el `UPDATE` bulk.

Reglas asociadas (no romper):

- `cancelOverlappingAppointments` devuelve la lista de filas modificadas (`UPDATE … RETURNING id, patient_name, patient_phone, starts_at`). Esa lista es **la única fuente de verdad** que alimenta el `after()` de Twilio; nunca recalcular la ventana ni hacer un SELECT separado para notificar.
- Si el `UPDATE` falla, `createScheduleException` debe hacer rollback del INSERT (`DELETE` por id) antes de devolver el error, para no dejar la excepción bloqueando la agenda sin haber avisado a los pacientes afectados.
- `checkExceptionConflicts` solo se usa para poblar el `AlertDialog`; el conteo final mostrado al admin viene de `cancelledCount` (= `rows.length` del UPDATE), nunca del check previo.

### 6.8 Slot RPCs — Arquitectura CTE (P-1)

`get_available_slots` y `get_slots_for_service` reescritas (migración `20260523300000`) para usar 6 CTEs que precargan los conjuntos de conflicto **una sola vez** antes del bucle de generación de slots:

```sql
WITH
  full_day_off     AS (SELECT 1 FROM doctor_schedule_exceptions WHERE ... AND is_working=false AND start_time IS NULL),
  custom_windows   AS (SELECT start_time, end_time FROM doctor_schedule_exceptions WHERE ... AND is_working=true),
  effective_windows AS (-- schedules normales si no hay custom_windows, si no, custom_windows),
  partial_blocks   AS (SELECT tstzrange(...) FROM doctor_schedule_exceptions WHERE is_working=false AND start_time IS NOT NULL),
  same_day_appts   AS (SELECT tstzrange(starts_at, ends_at, '[)') FROM appointments WHERE status='confirmed'),
  candidate_slots  AS (-- genera el rango de slots de la ventana efectiva)
SELECT slot_start FROM candidate_slots
WHERE NOT EXISTS (SELECT 1 FROM partial_blocks WHERE partial_blocks.r && slot_range)
  AND NOT EXISTS (SELECT 1 FROM same_day_appts WHERE same_day_appts.r && slot_range)
```

**Invariante**: los CTEs `partial_blocks` y `same_day_appts` se materializan una vez. El filtro final es un NOT EXISTS sobre estructuras en memoria, no un EXISTS iterativo contra la tabla. **Nunca revertir al patrón `EXISTS (SELECT 1 FROM appointments WHERE …)` dentro del bucle de generación de slots** — multiplica las lecturas de tabla por número de slots candidatos.

---

## 7. Deuda Técnica Conocida

**Sin deuda técnica crítica pendiente.**

Todos los hallazgos D-1 a D-12 del Ultra-Review fueron resueltos en la sesión 2026-05-23:

| ID | Resolución | Migración / Commit |
|---|---|---|
| D-1 | Archivos duplicados `001_initial.sql` y `20260515000000_initial_schema.sql` eliminados del repo; entradas borradas de `supabase_migrations.schema_migrations` | D-1 cleanup + historial remoto |
| D-2 | `lib/supabase/types.ts` regenerado vía `npm run db:types` | commit perf+debt |
| D-3 | OTP helpers eliminados de `lib/utils.ts` | commit `703bf3a` |
| D-4 | RPCs `book_slot` / `confirm_appointment` dropeadas de la DB | `20260523100000` |
| D-5 | Enum `appointment_status` rebuildeado (solo `confirmed`/`cancelled`); types.ts regenerado | `20260523200000` |
| D-6 | CHECK constraints `color` añadidos a `services` y `appointments` | `20260523300000` |
| D-7 | `vercel.json` creado con cron schedule | commit perf+debt |
| D-8 | Policy `public_read_clinics` añadida a migraciones (drift resuelto) | `20260523300000` |
| D-9 | `fn_set_updated_at` + `fn_check_schedule_overlap` + `get_active_dow_for_service` con `search_path` fijado; `fn_handle_new_user` confirmado inexistente (no aplica) | `20260523200000` |
| D-10 | `idx_appt_otp_expiry` dropeado; `adminCancelAppointment` y `bookAppointmentManual` usan session client | `20260523200000` + commit |
| D-11 | `sanitizePhone` eliminó prefijo `+34` hardcodeado | commit perf+debt |
| D-12 | `getBaseUrl()` elimina `PROD_FALLBACK`; lanza en Vercel sin vars de URL | commit perf+debt |

---

## 8. Stand-By / Pendiente (NO modificar)

### Recordatorios Automáticos 24h

**Estado**: implementado en código, cron desactivado intencionadamente.

**Motivo**: el plan Hobby de Vercel no soporta crons con frecuencia horaria.

| Pieza | Archivo | Estado |
|---|---|---|
| Columna `reminder_sent BOOLEAN DEFAULT false` | `003_whatsapp_instant_booking.sql` | ✅ En BD |
| `sendWhatsAppReminder()` | `lib/twilio/client.ts` | ✅ Listo |
| `GET /api/cron/reminders` | `app/api/cron/reminders/route.ts` | ✅ Listo (`Promise.allSettled` concurrente — B-9 resuelto) |
| `vercel.json` | raíz del proyecto | ✅ Creado (D-7 resuelto) |

**Para activar** (solo falta esto):
1. Añadir `CRON_SECRET` en Vercel Dashboard → Settings → Environment Variables.
2. Hacer deploy — Vercel detectará `vercel.json` y registrará el cron automáticamente.

---

## 9. Git — Estado del Repositorio

**Remote**: `https://github.com/GXA-Studio/medical-booking-boilerplate.git`  
**Vercel**: `https://medical-booking-boilerplate.vercel.app`  
**Rama activa**: `main`

| Hash | Descripción |
|---|---|
| `0d0b462` | chore(init): setup nextjs structure, db schema and context |
| `87e4bf8` | fix(security): apply audit patches (C-01 through M-04) |
| `e438e36` | feat(admin): complete admin dashboard |
| `a7ff83d` | fix(admin): make timezone dynamic |
| `b3a116f` | feat(booking): add patient booking flow + fix TypeScript types |
| `faa19d2` | fix(types): upgrade @supabase/ssr 0.5.2→0.10.3 |
| `8ccd130` | test(e2e): add Playwright booking funnel + Vercel deployment config |
| `33aecb9` | chore: final quality audit and typescript fixes |
| `4c815e5` | perf: implement parallel fetching, redis caching, and db indexing |
| `625198c` | feat: add 24h automated whatsapp reminders and admin manual booking UI |
| `049ad85` | feat: dead-end prevention — "Buscar próximo hueco libre" en WeeklyGrid |
| `4901321` | feat(admin): smart fast-forward for next available slot in admin dialog |
| `7b2ea2a` | feat(admin): implement server-side global search for appointments |
| `1c88e21` | feat(admin): add chromatic color system for agenda appointment cards |
| `4e84b20` | fix(admin): repair color swatches purged by Tailwind in production |
| `806256b` | feat: instant color updates, auto-dismiss toasts, optimistic exceptions |
| `38097a7` | feat: partial time blocks, multiple exceptions per day, no-store slots cache |
| `5a8a9fa` | fix(security): critical RPC validation patches for cross-tenant isolation (S-1, S-2, S-3, S-4) |
| `51c8733` | fix(security): application-layer patches (S-5 cookie, S-6/S-7 rate-limits, S-8 service-clinic check, S-9/S-10 webhook signing) |
| `(B-1)` | fix(agenda): resolve B-1 race condition by persisting exceptions prior to cancellation and purge dead OTP code |
| `(B2-B9)` | fix(logic): resolve B-2 to B-9 edge cases, cleanup enums, and enforce atomic RPC updates |
| `(P+D)` | chore: resolve remaining performance and tech debt findings (P-1, P-5, P-6, D-1 to D-12) |
| `(HEAD)` | docs: sync SSOT removing resolved tech debt and detailing CTE performance architecture |
