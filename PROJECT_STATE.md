# PROJECT STATE — Medical Booking Boilerplate · Pipeline Técnico
> **Single source of truth técnico** para todas las sesiones futuras.  
> Última actualización: **2026-05-23** — Ultra-Review audit + critical security patches (S-1–S-10), B-1 race-condition fix en `createScheduleException`, y purga de RPCs OTP legacy (`book_slot`, `confirm_appointment`).  
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
**`clinics.admin_id` NO EXISTE** en la DB — el `lib/supabase/types.ts` lo lista erróneamente (schema drift pendiente de corregir).

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
| `idx_appt_otp_expiry` | appointments | filtro `status='pending'` | 💀 MUERTO — status ya no puede ser 'pending' |
| `marketing_leads_created_at_idx` | marketing_leads | `created_at DESC` | ✅ Activo |
| `marketing_leads_status_idx` | marketing_leads | `status` | ✅ Activo |
| `marketing_leads_email_idx` | marketing_leads | `email` | ✅ Activo |
| UNIQUE idx parcial en exceptions | doctor_schedule_exceptions | `(doctor_id, date, is_working, COALESCE(st,'00:00'), COALESCE(et,'00:00'))` | ✅ Activo |

---

### 2.3 RPCs Activas

Todas las SECURITY DEFINER tienen `SET search_path = pg_catalog, public` (fix S-4, migration `20260523000000`).

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
| `fn_handle_new_user()` | TRIGGER (after insert on auth.users) | ✅ | ❌ **Falta** | ⚠️ S-4 parcial pendiente |
| `fn_set_updated_at()` | TRIGGER (before update on clinics) | ✅ | ❌ **Falta** | ⚠️ S-4 parcial pendiente |

---

### 2.5 Migraciones — Lista Completa (20)

| Archivo | Contenido | Nota |
|---|---|---|
| `001_initial.sql` | Schema base inicial (versión 1) | ⚠️ Duplicado con `20260515000000` y `20260515_final_schema` |
| `002_add_phone_constraint.sql` | Constraint E.164 en patient_phone | — |
| `003_whatsapp_instant_booking.sql` | `cancellation_token`, `reminder_sent`, `book_slot_confirmed` RPC (versión 1) | — |
| `20260515000000_initial_schema.sql` | Schema base (versión 2, con variaciones) | ⚠️ Duplicado; no idempotente |
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
| `20260523100000_drop_legacy_otp_rpcs.sql` | `DROP FUNCTION book_slot`, `DROP FUNCTION confirm_appointment` | Última migración aplicada |

**Deuda D-1**: `001_initial.sql`, `20260515000000_initial_schema.sql` y `20260515_final_schema.sql` definen bases similares con variaciones. Sin ser idempotentes. Consolidar a una sola migración inicial antes del próximo `supabase db push`.

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
- **service_role**: bypassa RLS; usado por `cancelByToken`, `cancelOverlappingAppointments`, `bookAppointmentManual`, `adminCancelAppointment`.
- **marketing_leads**: RLS deny-by-default (sin políticas). Solo service_role vía `/api/leads`.
- **clinics (public read)**: la policy `public_read_clinics` NO está en ningún archivo de migración — drift detectado. El booking público funciona en prod porque existe en la DB directamente. **Pendiente**: añadir la policy al repo o reemplazar las queries anon a `clinics` por `createServiceClient()`.

### 3.3 SECURITY DEFINER — search_path

Estado tras migración `20260523000000`:

| Función | search_path fijado |
|---|---|
| `get_available_slots` | ✅ `SET search_path = pg_catalog, public` |
| `get_slots_for_service` | ✅ |
| `book_slot_confirmed` | ✅ |
| `reschedule_appointment` | ✅ |
| `fn_handle_new_user` | ❌ Pendiente |
| `fn_set_updated_at` | ❌ Pendiente |

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

---

## 7. Deuda Técnica Conocida

| ID | Descripción | Impacto | Prioridad |
|---|---|---|---|
| **D-1** | Migraciones duplicadas: `001_initial`, `20260515000000_initial_schema`, `20260515_final_schema` definen bases similares sin ser idempotentes | `supabase db push` futuro puede chocar | Alta |
| **D-2** | `lib/supabase/types.ts` desactualizado: tiene `clinics.admin_id` inexistente, falta `marketing_leads`/`insurances`/`doctor_insurances`/`legal_name`/`cif`, lista RPCs muertas (`book_slot`, `confirm_appointment`), columnas `otp_*` | Casts `as never` / `as unknown` en código | Alta |
| **D-5** | `appointment_status` type enum aún expone `'pending'` aunque el CHECK ya no lo permite | tipos.ts diverge de la DB | Baja |
| **D-6** | `services.color` y `appointments.color` sin CHECK constraint en DB (solo Zod lo valida) | UPDATE SQL directo puede insertar valores inválidos | Baja |
| **D-7** | `vercel.json` no existe en el repo. §8 lo documenta como "vacío" pero el archivo no está | Cron no activable sin crear el archivo | Baja |
| **D-8** | `public_read_clinics` policy no está en ninguna migración — solo existe en la DB de prod | Schema drift; si se dropea la DB no se recrea | Media |
| **D-9** | `fn_handle_new_user` y `fn_set_updated_at` son SECURITY DEFINER sin `SET search_path` | CVE-class search_path hijacking (S-4 parcial) | Alta |
| **D-10** | `idx_appt_otp_expiry` filtra por `status='pending'` que ya no existe → índice muerto | Waste de storage y mantenimiento PG | Baja |
| **D-11** | `bookAppointmentManual.sanitizePhone` hardcoded a España (`+34` si 9 dígitos 6/7) | Clínicas no españolas reciben número corrupto | Media (antes de internacionalizar) |
| **D-12** | `getBaseUrl()` tiene PROD_FALLBACK hardcoded a `medical-booking-boilerplate.vercel.app` | Forks / clientes con otro dominio reciben links rotos | Media |

> **Resueltos** (gaps en la numeración): **D-3** (OTP helpers en `lib/utils.ts`) y **D-4** (RPCs `book_slot`/`confirm_appointment` en DB) → eliminados en commit `703bf3a` + migración `20260523100000_drop_legacy_otp_rpcs.sql`. **B-1** (race condition en `createScheduleException`) → estructuralmente cerrada por persistencia previa de la excepción; ver §6.7.

---

## 8. Stand-By / Pendiente (NO modificar)

### Recordatorios Automáticos 24h

**Estado**: implementado en código, cron desactivado intencionadamente.

**Motivo**: el plan Hobby de Vercel no soporta crons con frecuencia horaria.

| Pieza | Archivo | Estado |
|---|---|---|
| Columna `reminder_sent BOOLEAN DEFAULT false` | `003_whatsapp_instant_booking.sql` | ✅ En BD |
| `sendWhatsAppReminder()` | `lib/twilio/client.ts` | ✅ Listo |
| `GET /api/cron/reminders` | `app/api/cron/reminders/route.ts` | ✅ Listo (secuencial — ver B-9) |
| `vercel.json` | raíz del proyecto | ❌ No existe |

**Cómo activar**:
1. Crear `vercel.json`:
   ```json
   { "crons": [{ "path": "/api/cron/reminders", "schedule": "0 * * * *" }] }
   ```
2. Añadir `CRON_SECRET` en Vercel Dashboard → Settings → Environment Variables.
3. Antes de activar: refactorizar el loop secuencial en `route.ts` a `Promise.allSettled` + batches (ver D-B9 en ultrareview).

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
| `(HEAD)` | fix(agenda): resolve B-1 race condition by persisting exceptions prior to cancellation and purge dead OTP code |
