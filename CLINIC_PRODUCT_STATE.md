# CLINIC PRODUCT STATE — Medical Booking Boilerplate
> **Single Source of Truth orientada a producto.** Describe qué se entrega a la clínica y cómo se mueve cada dato a través del sistema.
> Última actualización: **2026-05-23**

---

## 0. Visión de Producto

Plataforma SaaS B2B de gestión de citas médicas con cuatro pipelines diferenciados:

| Pipeline | Audiencia | Propósito |
|---|---|---|
| **Reservas** | Paciente final | Reservar / autogestionar cita sin llamar a recepción |
| **Administración** | Staff de la clínica | Operar la agenda, médicos, servicios y horarios |
| **Captación** | GXA Studio (comercial) | Capturar y notificar leads desde la landing pública |
| **Comunicación** | Twilio ↔ Paciente | Notificaciones salientes + interfaz conversacional entrante |

Cada clínica recibe la plataforma como producto white-label: su nombre, CIF y datos legales se inyectan dinámicamente en las páginas legales, y el wizard de reservas filtra automáticamente por sus mutuas concertadas.

---

## 1. El Producto Entregable

### 1.1 Reserva de Pacientes — Buscador Tipo Doctoralia

**Ruta pública**: `/[clinicSlug]` (ej. `/clinica-prueba`).

#### Capa de presentación

El componente raíz es `BookingSearch` (`components/booking/booking-search.tsx`), un buscador horizontal con **cuatro filtros simultáneos** sobre la cabecera (`SearchBar`):

| Filtro | UI | Comportamiento |
|---|---|---|
| **Servicio / Especialidad** | `select` con todos los servicios activos de la clínica | Determina la duración del slot y los médicos elegibles |
| **Profesional** | `select` (default: "Cualquier profesional") | Restringe la búsqueda a un médico concreto |
| **Fecha + Franja horaria** | `input[type=date]` + toggle pill Mañana/Tarde/Todo | Define el día base de la ventana de 7 días |
| **Mutua / Seguro** | `select` con todas las mutuas concertadas + "Todas las mutuas" | Restringe a los médicos que aceptan la mutua seleccionada |

Debajo del buscador, `WeeklyGrid` renderiza los 7 días con la disponibilidad agregada del subconjunto de médicos resultante (intersección de los filtros). Cada hueco es un botón que abre `BookingModal`.

#### Flujo de datos del wizard

```
1. /[clinicSlug] (Server Component)
   └── Carga clinics + services + doctors + doctor_services + insurances + doctor_insurances
       (parallel fetch, cacheado en Upstash 5 min con clave mbb:booking:v2:{slug})

2. SearchBar (Client) — actualiza SearchFilters
   ├── serviceId
   ├── doctorId          (null = cualquier profesional)
   ├── date + timeOfDay
   └── insuranceId       (null = todas las mutuas)

3. GET /api/slots/week?serviceId&startDate[&doctorId]
   └── Llama RPC get_available_slots o get_slots_for_service
       según haya doctorId fijo o no

4. WeeklyGrid filtra slots aplicando:
   - Mutua: intersección con doctorInsurances[doctorId]
   - Franja horaria: morning (HH < 14) / afternoon (HH >= 14)
   - Si no hay huecos en 7 días → botón "Buscar próximo hueco libre"
       → Server Action findNextAvailableDate (scan de hasta 45 días)

5. Click en hueco → BookingModal (Client)
   ├── Paso 1: datos del paciente (nombre + teléfono E.164)
   └── Paso 2: confirmación
       └── POST /api/book

6. /api/book
   ├── Validación Zod (UUIDs, E.164, datetime ISO)
   ├── Rate-limit por IP (10/h, Upstash slidingWindow)
   ├── RPC book_slot_confirmed (atomic; protegido por EXCLUDE constraint)
   ├── sendWhatsAppConfirmation
   └── Respuesta { appointmentId } al modal → pantalla de éxito
```

#### Sistema de mutuas — modelo de datos

| Tabla | Propósito |
|---|---|
| `insurances` | Catálogo de mutuas (id, name, logo_url). Seed inicial con Adeslas, Sanitas, Mapfre Salud, Asisa, DKV, Allianz Care, Privado |
| `doctor_insurances` | Tabla pivote `(doctor_id, insurance_id)` — qué médico acepta qué mutuas |

La clínica gestiona esta relación desde el admin (al editar el médico). El filtro de mutua del buscador hace la intersección en cliente sobre `doctorInsurances: Record<doctorId, insuranceId[]>` precargado, sin round-trip adicional.

#### Autogestión post-reserva

Tras el booking, el paciente recibe en WhatsApp un enlace único `/manage/{cancellation_token}` (UUID generado por la DB). Desde ese portal puede:

- **Cancelar** la cita (sólo si está confirmada y es futura).
- **Reprogramar** a otro hueco del mismo médico/servicio.

Ambas acciones disparan un nuevo mensaje de WhatsApp informando al paciente (`sendCancellationWhatsApp` / `sendRescheduleWhatsApp`).

---

### 1.2 Panel de Administración

**Ruta**: `/admin` (redirige a `/admin/appointments`).
**Auth**: Supabase Auth (email + password). El middleware (`middleware.ts`) intercepta cualquier `/admin/*` sin sesión y redirige a `/auth/login`.

#### Shell y navegación

`AdminShell` (`components/admin/admin-shell.tsx`) — sidebar fijo en desktop, drawer en móvil. Items de navegación: **Citas / Agenda / Médicos / Servicios / Horarios**.

#### Pantallas

| Pantalla | Ruta | Función |
|---|---|---|
| Citas | `/admin/appointments` | Tabla server-side con búsqueda por nombre/teléfono (debounce 300 ms, URL state `?q=`), filtros por estado/fecha, stats strip, y dialog "Nueva cita" |
| Agenda | `/admin/agenda` | Resource-grid diaria por médico con overlays visuales de excepciones |
| Médicos | `/admin/doctors` | CRUD + asignación de servicios + asignación de mutuas |
| Servicios | `/admin/services` | CRUD + color por servicio + duración |
| Horarios | `/admin/schedules` | Horario semanal recurrente + excepciones puntuales |

#### Agenda reactiva (resource-grid diaria)

`daily-resource-grid.tsx` pinta una columna por médico activo, con filas verticales por intervalo. Las tarjetas de cita se colocan absolute-positioned sobre la columna.

**Sistema de colores cromáticos** — cada tarjeta hereda su color por orden de prioridad:
1. `appointments.color` (override por cita)
2. `services.color` (color base del servicio)
3. `'blue'` (fallback)

Colores válidos: `blue | emerald | purple | amber | rose`. Las citas pasadas se muestran siempre en gris (`slate`) independientemente del color asignado. El admin puede cambiar el color de una cita individual con el picker de puntos circulares del `EditAppointmentDialog` (actualización óptica con `useTransition`).

**Overlays de excepciones**:
- **Día Completo Libre** → cuadro rojo rallado a 45° cubriendo toda la columna, con chip rotado "Día No Disponible".
- **Bloqueo Horario Parcial** → cuadro ámbar rallado posicionado por `start_time`/`end_time`, con chip "Bloqueo Horario" + rango monospace.

Los overlays son `pointer-events-none` para que las tarjetas de cita encima sigan siendo clicables, pero las celdas vacías dentro del bloqueo **no son clicables** para crear citas nuevas.

#### Creación manual de citas

`NewAppointmentDialog` (botón "Nueva cita" en `/admin/appointments`):

1. Nombre del paciente + teléfono (acepta 9 dígitos españoles → autocompleta `+34`).
2. Selector de médico (carga médicos activos de la clínica).
3. Selector de servicio (filtrado a los que ofrece ese médico).
4. Selector de fecha (`min = hoy`).
5. Horarios disponibles (fetch live a `GET /api/slots`).
6. Resumen visual + confirmar.

**Smart Forwarding (dead-end prevention)**: si el día seleccionado no tiene huecos, aparece el botón "Buscar próximo hueco libre" que ejecuta la Server Action `findNextAvailableDate` (scan día-a-día hasta 45 días en Supabase). La misma Server Action se reutiliza desde el flujo público del paciente.

Toda cita creada por el admin es **indistinguible** de una cita creada por el paciente: misma RPC `book_slot_confirmed`, mismo WhatsApp de confirmación, mismo portal `/manage/[token]`.

#### Gestión de horarios y bloqueos

`ScheduleEditor` (`/admin/schedules`) — tabs por médico, con dos bloques diferenciados:

- **Horario semanal**: lista de 7 días con sus turnos como pills (`08:00–14:00`), switch para activar/desactivar y botón eliminar. Soporta múltiples turnos por día (mañana + tarde).
- **Días Específicos / Excepciones**: dialog "Añadir excepción" con dos modos seleccionables:
  - **Día Completo Libre** (rosa, `CalendarOff`): bloquea el día entero.
  - **Bloqueo Horario Parcial** (ámbar, `Ban`): bloquea sólo la franja `start_time`–`end_time`.

Se permiten **múltiples bloqueos por fecha** (ej. mañana 10:00-10:30 + tarde 14:00-16:00).

**Pipeline anti-conflicto al guardar una excepción**:

```
1. Admin pulsa "Guardar excepción"
   ↓
2. checkExceptionConflicts(input)
   - Calcula ventana UTC con date-fns-tz (DST-safe)
   - Busca confirmed appointments cuyo [starts_at, ends_at) solape
   ↓
3. ¿Hay conflictos?
   ├── NO  → persistException directamente
   └── SÍ  → AlertDialog "Atención: Hay citas programadas"
            con lista de pacientes afectados
            └── Si admin confirma:
                ├── createScheduleException(input, { cancelOverlapping: true })
                ├── Bulk UPDATE status='cancelled' (service role)
                └── after() + Promise.allSettled → WhatsApp empático a cada paciente
                    "El Dr. X ha tenido un imprevisto..."
                    + link de reprogramación a la home de la clínica
```

Toda mutación de horario/excepción ejecuta `bustSlotCaches(clinicSlug)` que invalida tanto el cache de Next (`revalidatePath`) como el cache Redis de la página de reservas (`invalidateBookingCache`). El calendario público y la agenda admin se repintan al instante.

---

### 1.3 Páginas Legales Dinámicas (White-Label)

Tres rutas legales, dos estáticas y una dinámica por clínica:

| Ruta | Contenido | Datos dinámicos |
|---|---|---|
| `/aviso-legal` | LSSI-CE art. 10 — datos identificativos del titular del servicio (GXA Studio) | Ninguno (estático) |
| `/privacidad?slug=<clinic>` | RGPD art. 13 — política de privacidad con identificación del Responsable del Tratamiento | **Sí** — `legal_name`, `cif`, `address` de la clínica |
| `/cookies` | Política de cookies del SaaS | Ninguno (estático) |

#### Pipeline de inyección de datos legales

```
Footer del booking page → <a href="/privacidad?slug={clinicSlug}">
                                              ↓
/privacidad/page.tsx (Server Component)
  └── searchParams.slug
       ↓
getClinicLegalData(slug)  [lib/clinics/legal.ts]
  └── SELECT name, legal_name, cif, address FROM clinics WHERE slug = ?
       ↓
Render con white-label values:
  - "Responsable del tratamiento" — denominación = legal_name || name
  - "NIF / CIF" — cif || "Facilitado en el contrato de prestación de servicios"
  - "Domicilio social" — address || fallback contractual
  - "Encargado del tratamiento" — GXA Studio (fijo, proveedor SaaS)
```

**Modelo de datos** (`clinics` table, columnas legales):

```
clinics.legal_name  TEXT NULLABLE  -- Razón social oficial registrada (puede diferir de name)
clinics.cif         TEXT NULLABLE  -- NIF / CIF español para RGPD art. 13
clinics.address     TEXT NULLABLE  -- Domicilio social
```

Si la clínica no tiene estos campos rellenos, el pipeline cae en un texto fallback ("Facilitado en el contrato de prestación de servicios"), de modo que el sistema sigue siendo legalmente coherente durante la fase pre-contrato.

La política identifica explícitamente a los **encargados del tratamiento** (Twilio Inc., Supabase Inc., Vercel Inc. bajo SCCs) y enumera los **derechos RGPD** (acceso, rectificación, supresión, oposición, limitación, portabilidad, retirada de consentimiento) con plazo de respuesta de 30 días.

---

## 2. El Pipeline de Captación (Leads & Marketing)

Pipeline B2B independiente del dominio clínico. Su único stakeholder es **GXA Studio**.

### 2.1 Punto de entrada — Landing pública

**Ruta**: `/` (root). Renderiza la landing comercial con el componente `LandingForm` (`components/marketing/landing-form.tsx`) en la sección de contacto.

Campos del formulario:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `name` | text | sí | Nombre y apellidos del prospect (2-120 chars) |
| `email` | email | sí | Email profesional (validado por Zod, max 200 chars) |
| `clinic` | text | sí | "Clínica + ciudad" en formato libre (2-200 chars) |
| `message` | textarea | no | Notas opcionales (max 2000 chars) |

### 2.2 Flujo completo del lead

```
1. Submit del LandingForm
   └── fetch POST /api/leads { name, email, clinic, message }

2. /api/leads (Route Handler)
   ├── Parse JSON
   ├── Validación Zod (LeadSchema)
   ├── Rate-limit por IP — leadsIpLimiter (5/h, Upstash slidingWindow)
   │   └── 429 si excedido (mensaje en español)
   ├── INSERT en marketing_leads (service role; RLS deny-by-default)
   │     {
   │       name, email, clinic, message,
   │       source: 'landing',
   │       ip:    <x-forwarded-for>,
   │       user_agent: <header>,
   │       status: 'new'         (default)
   │     }
   └── sendLeadNotificationEmail(payload)
       └── Best-effort: si falla, el lead ya está en BD; se loguea pero no se aborta la respuesta al usuario

3. Respuesta 201 { leadId } → UI muestra confirmación
   "¡Recibido! Nos ponemos en contacto en menos de 24 horas..."
```

### 2.3 Almacenamiento — tabla `marketing_leads`

```
marketing_leads
├── id           UUID PRIMARY KEY DEFAULT uuid_generate_v4()
├── created_at   TIMESTAMPTZ DEFAULT NOW()
├── name         TEXT NOT NULL
├── email        TEXT NOT NULL
├── clinic       TEXT NOT NULL                   -- "Clínica X — Valencia"
├── message      TEXT                            -- opcional
├── source       TEXT NOT NULL DEFAULT 'landing' -- 'landing' | 'prospecting-engine' | ...
├── ip           TEXT                            -- captura forense / spam analysis
├── user_agent   TEXT
├── status       TEXT NOT NULL DEFAULT 'new'
│                CHECK (status IN ('new', 'contacted', 'demo_scheduled',
│                                  'closed_won', 'closed_lost', 'spam'))
└── notes        TEXT                            -- anotaciones internas del equipo

Índices:
- marketing_leads_created_at_idx   (DESC para timeline)
- marketing_leads_status_idx
- marketing_leads_email_idx        (dedup / búsqueda)
```

El campo `status` modela el funnel de ventas (CRM ligero): `new → contacted → demo_scheduled → closed_won | closed_lost | spam`. Se actualiza manualmente desde el SQL editor de Supabase.

### 2.4 Notificación dual por email — `lib/email/notifier.ts`

Implementado con **Nodemailer** sobre Gmail (App Password). Tras cada INSERT exitoso, se envían **dos correos en paralelo** (`Promise.all`):

#### Email A — Notificación interna al equipo GXA

```
To:       studiogxa@gmail.com
From:     "GXA Studio" <GMAIL_APP_USER>
Reply-To: <email del lead>           ← responder al lead con un solo click
Subject:  Nuevo lead — {name} ({clinic})

Cuerpo HTML estructurado:
  🦷 Nuevo lead
  ┌─────────────────────────────────────┐
  │ Nombre   | <name>                   │
  │ Email    | <email> (mailto link)    │
  │ Clínica  | <clinic>                 │
  └─────────────────────────────────────┘
  [si message]
  ┌─────────────────────────────────────┐
  │ Nota:                               │
  │ <message escapado <,> → &lt;,&gt;>  │
  └─────────────────────────────────────┘
```

#### Email B — Confirmación automática al lead

```
To:       <email del lead>
From:     "GXA Studio" <GMAIL_APP_USER>
Reply-To: studiogxa@gmail.com
Subject:  Hemos recibido tu consulta — GXA Studio

Cuerpo HTML:
  "Hola {name}, gracias por tu interés. Nos pondremos en contacto contigo
   en menos de 24 horas laborables para agendar tu consulta inicial gratuita."
  [Botón CTA: "Ver demo"] → https://medical-booking-boilerplate.vercel.app/#demo
```

### 2.5 Variables de entorno requeridas

```bash
GMAIL_APP_USER=studiogxa@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx   # Gmail App Password (Account → Security → 2-Step Verification → App passwords)
```

Si estas variables están ausentes, el helper `sendLeadNotificationEmail` hace **no-op silencioso** (loguea warning y retorna). El lead sigue guardándose correctamente en BD — la pérdida del email no rompe la captura.

---

## 3. El Pipeline de Comunicación (Twilio & IA)

Dos canales sobre Twilio: **outbound transaccional** (notificaciones) y **inbound conversacional** (webhooks). Todo el código en `lib/twilio/client.ts` y `app/api/webhooks/*`.

### 3.1 Outbound — Notificaciones transaccionales (WhatsApp)

Cuatro funciones, todas con la misma firma base `(to, patientName, clinicName, startsAt, timezone, ...)` y todas usando `await` estricto:

| Función | Disparador | Mensaje | Incluye link gestión |
|---|---|---|---|
| `sendWhatsAppConfirmation` | `POST /api/book`, `bookAppointmentManual` | "Tu cita para *{servicio}* ha sido confirmada en {clínica}..." | ✅ `/manage/{token}` |
| `sendCancellationWhatsApp` (paciente) | `cancelByToken` server action | "Tu cita en {clínica} para el día {fecha} ha sido cancelada correctamente." | ❌ |
| `sendCancellationWhatsApp` (clínica) | `cancelOverlappingAppointments` (bulk) | **Mensaje empático**: "Lamentamos comunicarte que el Dr. X ha tenido un imprevisto..." | ✅ Link de reprogramación a `/{clinicSlug}` |
| `sendRescheduleWhatsApp` | `rescheduleAppointment` server action | "¡Cita actualizada! Tu nueva reserva en {clínica} es el {fecha}..." | ✅ `/manage/{token}` |
| `sendWhatsAppReminder` | `GET /api/cron/reminders` | "⏰ Recordatorio: mañana tienes cita..." | ✅ `/manage/{token}` |

Todos los mensajes incluyen el aviso AEPD/RGPD: *"Tratamos tus datos según el RGPD. Responde INFO para más detalles."*

#### Cancelación masiva post-excepción — pipeline deferido

Cuando el admin crea una excepción que solapa con N citas, la response del Server Action vuelve al instante. Twilio se ejecuta en segundo plano:

```
createScheduleException({ cancelOverlapping: true })
  ├── Bulk UPDATE status='cancelled' (síncrono)
  └── after(async () => {
        const results = await Promise.allSettled(
          rows.map(r => sendCancellationWhatsApp({ ... }))
        )
        // Fallos individuales no abortan al resto
      })
```

La función Vercel permanece viva hasta que todos los `await` resuelven, pero la UI ya muestra el toast de éxito.

#### Variables de entorno

```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+15005550006        # SMS (legacy)
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886   # Sandbox; sustituir por número aprobado en prod
```

### 3.2 Inbound — Webhook conversacional (la "IA ligera" del paciente)

Cuando un paciente responde a cualquier mensaje de WhatsApp, Twilio entrega el mensaje en `POST /api/webhooks/whatsapp`. Esto convierte el WhatsApp en un **canal bidireccional** sin que el paciente tenga que abrir ningún link.

#### Pipeline

```
1. Paciente responde "cancelar" (o similar) por WhatsApp
   ↓
2. Twilio POST /api/webhooks/whatsapp
   ├── Validación HMAC-SHA1 de la firma X-Twilio-Signature
   │   (URL reconstruida desde x-forwarded-proto + x-forwarded-host)
   ├── Parse de form-data: From, Body
   └── Normalización del body:
       - lowercase
       - normalize('NFD')             ← descompone diacríticos
       - replace acentos combinantes  ← "cancelár" → "cancelar"
       - trim
   ↓
3. Keyword routing (orden de prioridad):
   ┌──────────────────────────────────────────────────────────────────────┐
   │ a) CANCELAR    ['cancelar','anular','baja','cancel']                 │
   │    └── SELECT próxima cita del teléfono                              │
   │        └── UPDATE status='cancelled'                                 │
   │        └── Respuesta TwiML: "✅ Cita anulada correctamente..."       │
   │                                                                      │
   │ b) MODIFICAR   ['modificar','cambiar','reprogramar','mover',         │
   │                 'reagendar','reschedule','cambio']                   │
   │    └── SELECT próxima cita + cancellation_token                      │
   │        └── Respuesta TwiML con link /manage/{token}                  │
   │                                                                      │
   │ c) INFO/RGPD   ['rgpd','privacidad','datos','info','legal',          │
   │                 'informacion']                                       │
   │    └── Respuesta TwiML con email DPD + link /privacidad              │
   │                                                                      │
   │ d) Default — menú de ayuda con las tres opciones disponibles         │
   └──────────────────────────────────────────────────────────────────────┘
   ↓
4. Twilio entrega la TwiML al paciente como mensaje WhatsApp
```

#### Resultado UX

El paciente puede gestionar su cita **escribiendo texto natural en español**, sin tocar el link. Tres palabras = tres flujos:

- "cancelar" → cita cancelada al instante (sin confirmación adicional)
- "modificar" → recibe link de reprogramación
- "info" → recibe instrucciones para ejercer derechos RGPD

El routing es **prioritario** (cancelar gana sobre modificar si ambas aparecen) y **tolerante a tildes** gracias a la normalización NFD.

### 3.3 Status callbacks de Twilio

`POST /api/webhooks/twilio` — endpoint configurado como "Status Callback URL" en Twilio. Recibe actualizaciones del estado de cada mensaje saliente (`sent`, `delivered`, `failed`, `undelivered`).

```
- Validación HMAC-SHA1 de la firma
- Log estructurado: [webhooks/twilio] {messageSid} → {status} (to: {to})
- Warning explícito ante failed/undelivered
- Response 200 OK (Twilio reintenta si recibe non-2xx)
```

Este endpoint da observabilidad pasiva sobre la entregabilidad — útil para detectar números bloqueados o errores de plantilla en el dashboard de Vercel.

### 3.4 Recordatorios 24h — endpoint listo, cron en stand-by

```
GET /api/cron/reminders
  - Auth: Bearer <CRON_SECRET>
  - Query: confirmed appointments con reminder_sent=false en [T+23h, T+25h]
  - Por cada cita:
      ├── sendWhatsAppReminder
      └── UPDATE reminder_sent=true
  - Response { sent, failed }
```

Se activará cuando la clínica migre a un plan de Vercel que soporte cron horario, configurando `vercel.json` con `{ crons: [{ path: "/api/cron/reminders", schedule: "0 * * * *" }] }`.

---

## 4. Modo Demo / Ventas

Pipeline diseñado para que un prospect explore el panel admin **sin registro y sin riesgo de mutar datos reales**. Es la herramienta comercial principal del funnel: enlace en la landing → panel completo en un click.

### 4.1 Entrada — `/admin/guest`

Endpoint `GET /admin/guest` (`app/(admin)/admin/guest/route.ts`):

```
1. Lee request entrante
   ↓
2. Crea cliente Supabase server-side
   ↓
3. signInWithPassword({ email: 'admin@demo.com', password: <hardcoded> })
   - Cookies de sesión Supabase se inyectan en la response
   ↓
4. Setea cookie mbb_guest=1
   - path: /admin
   - sameSite: lax
   - maxAge: 2h
   ↓
5. Redirect 302 → /admin
```

El prospect que pulsa "Probar demo" en la landing aterriza **directamente** en `/admin/appointments` con sesión completa de la cuenta `admin@demo.com`.

### 4.2 Detección de modo demo — `lib/admin/guest-guard.ts`

```ts
export async function isGuestMode(): Promise<boolean> {
  const jar = await cookies()
  if (jar.get(GUEST_COOKIE)?.value !== '1') return false   // sin cookie → no es guest

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email === 'admin@demo.com'                  // solo cuenta demo
}

export const DEMO_RESULT = { demo: true } as const
```

Doble check: la cookie `mbb_guest=1` **+** la sesión Supabase pertenece a `admin@demo.com`. Esto impide que la cookie funcione si el usuario no es demo.

### 4.3 Bypass de mutaciones — patrón DEMO_RESULT

Cada Server Action que modifica la base de datos comprueba `isGuestMode()` como **primera línea** y retorna `DEMO_RESULT` sin tocar nada:

```ts
export async function cancelAppointment(id: string) {
  if (await isGuestMode()) return DEMO_RESULT          ← cortocircuito demo
  // ... lógica real solo se ejecuta si no es demo
}
```

Server Actions protegidas con este patrón:

| Dominio | Acciones bypaseadas en demo |
|---|---|
| Citas (`appointments/actions.ts`) | `cancelAppointment`, `bookAppointmentManual` |
| Agenda (`agenda/actions.ts`) | `adminCancelAppointment`, `adminRescheduleAppointment`, `adminUpdateAppointmentColor` |
| Médicos (`doctors/actions.ts`) | `createDoctor`, `updateDoctor`, `toggleDoctor` |
| Servicios (`services/actions.ts`) | `createService`, `updateService`, `toggleService` |
| Horarios (`schedules/actions.ts`) | `createSchedule`, `deleteSchedule`, `toggleSchedule`, `createScheduleException`, `deleteScheduleException` |

Resultado: el prospect puede pulsar **cualquier botón del panel** (crear cita, cancelar, mover, bloquear, eliminar médico, cambiar color, etc.) y ver el feedback óptico de la UI, pero **la base de datos permanece intacta**. La cuenta demo siempre vuelve al estado seed después de la sesión.

### 4.4 Indicador visual

`AdminLayout` (`app/(admin)/admin/layout.tsx`) lee la cookie y pasa el flag `isGuest` a `AdminShell`. El shell muestra un banner sutil de "Modo demo" para que el prospect entienda que está en un entorno de pruebas, sin que rompa la inmersión comercial.

### 4.5 Flujo comercial completo

```
Landing /                                  (form de captación de leads)
   ├── Sección "Ver demo en vivo"
   │     └── <a href="/clinica-prueba">     (booking público real)
   │
   └── Sección "Probar el panel"
         └── <a href="/admin/guest">        (auto-login demo)
                 ↓
            /admin (con cookie mbb_guest=1 y sesión admin@demo.com)
                 ↓
            Prospect navega panel completo
            ├── Crea citas → DEMO_RESULT, no toca BD
            ├── Cancela    → DEMO_RESULT, no toca BD
            ├── Cambia colores, horarios, médicos → todo bypaseado
            └── Cookie expira a las 2h → auto-cleanup
```

El loop comercial es: **lead** (landing form → email a GXA Studio + confirmación al lead) **+ demo navegable** (`/admin/guest`) **+ booking público real** (`/clinica-prueba`) — tres puntos de contacto que dan al prospect contexto operativo completo antes de la llamada de ventas.

---

## 5. Resumen del Stack de Datos

| Capa | Tecnología | Persistencia |
|---|---|---|
| **Frontend** | Next.js 15 App Router (RSC + Client Components) | — |
| **Base de datos** | PostgreSQL 15+ (Supabase) | `clinics`, `services`, `doctors`, `schedules`, `doctor_schedule_exceptions`, `appointments`, `insurances`, `doctor_insurances`, `marketing_leads`, `profiles` |
| **Auth** | Supabase Auth (cookie SSR) | `profiles` ↔ `auth.users` |
| **Mensajería** | Twilio WhatsApp + Status Callbacks | Out: confirmación, cancelación, reprogramación, recordatorio. In: webhook conversacional |
| **Email transaccional** | Nodemailer + Gmail App Password | Leads → studiogxa@gmail.com + confirmación al lead |
| **Cache & rate-limit** | Upstash Redis | `mbb:booking:v2:{slug}` (TTL 5 min), `@mbb/booking:ip` (10/h), `@mbb/slots:ip` (60/min), `@mbb/leads:ip` (5/h) |
| **Hosting** | Vercel (serverless) | `after()` para tareas deferidas (Twilio bulk) |
| **Validación** | Zod | Todos los Route Handlers públicos + Server Actions |
| **Fechas** | date-fns + date-fns-tz | Aritmética + conversión IANA DST-safe |

---

## 6. Mapa de Endpoints Públicos

| Método | Ruta | Audiencia | Rate-limit | Propósito |
|---|---|---|---|---|
| GET | `/[clinicSlug]` | Paciente | — | Buscador de citas público (white-label por clínica) |
| GET | `/api/slots` | Paciente | 60/min IP | Slots libres por médico+servicio+fecha |
| GET | `/api/slots/week` | Paciente | 60/min IP | Slots libres de 7 días |
| GET | `/api/available-days` | Paciente | — (cache 5 min) | Días de la semana activos por servicio |
| POST | `/api/book` | Paciente | 10/h IP | Confirma una reserva |
| GET | `/manage/{token}` | Paciente | — | Portal autogestión post-reserva |
| POST | `/api/leads` | GXA Studio | 5/h IP | Captación de leads desde landing |
| POST | `/api/webhooks/whatsapp` | Twilio | HMAC | IA conversacional entrante |
| POST | `/api/webhooks/twilio` | Twilio | HMAC | Status callbacks de mensajes |
| GET | `/admin/guest` | Demo | — | Auto-login modo demo |
| GET | `/admin/*` | Staff | Auth Supabase | Panel de gestión |
| GET | `/aviso-legal`, `/privacidad?slug=…`, `/cookies` | Cualquiera | — | Documentos legales (privacidad es white-label) |

---

*Documento orientado a producto. Para invariantes técnicos de la implementación, ver `PROJECT_STATE.md`.*
