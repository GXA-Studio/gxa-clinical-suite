# ONBOARDING SOP — Medical Booking Boilerplate
## Standard Operating Procedure: Alta de Nueva Clínica

> **Propietario del proceso**: GXA Studio  
> **Objetivo**: Despliegue funcional y entregado en **≤ 48 horas** desde la firma del contrato.  
> **Versión**: 1.0 — 2026-05-15  
> **Audiencia**: Equipo técnico y comercial de GXA Studio.

---

## Índice

- [FASE 0 — Cierre Comercial y Legal](#fase-0--cierre-comercial-y-legal)
- [FASE 1 — Infraestructura de Comunicaciones (Twilio)](#fase-1--infraestructura-de-comunicaciones-twilio)
- [FASE 2 — Despliegue Web y Dominios (Vercel)](#fase-2--despliegue-web-y-dominios-vercel)
- [FASE 3 — Setup de Base de Datos y White-Glove Service](#fase-3--setup-de-base-de-datos-y-white-glove-service)
- [FASE 4 — Entrega y Formación (Handoff)](#fase-4--entrega-y-formación-handoff)
- [Checklist de Cierre de Proyecto](#checklist-de-cierre-de-proyecto)
- [Contactos y Escalado](#contactos-y-escalado)

---

## FASE 0 — Cierre Comercial y Legal

**Responsable**: Equipo Comercial GXA Studio  
**Duración estimada**: 1–2 días (dependiente del cliente)  
**Bloqueo duro**: No se toca ningún sistema ni dato hasta que ambos documentos estén firmados.

---

### 0.1 Propuesta Comercial y Cobro de Setup

1. **Enviar propuesta** al decisor de la clínica (director, gerente o propietario) con:
   - Precio del plan mensual/anual contratado.
   - Cuota única de **Setup** (configuración inicial, volcado de datos, formación).
   - SLA de 48 h para el primer despliegue.

2. **Cobrar la cuota de Setup** antes de iniciar cualquier trabajo técnico.
   - Método: factura proforma + transferencia bancaria o Stripe (pago manual inicial).
   - Emitir factura formal con IVA a nombre de la entidad de la clínica.
   - Guardar justificante en la carpeta del cliente en GDrive.

3. **Confirmar la contratación** por escrito (email de confirmación o firma del pedido).

> ⚠️ **Regla**: Sin cobro de Setup confirmado, el onboarding no avanza a Fase 1.

---

### 0.2 Contrato de Encargado de Tratamiento (RGPD)

El software almacena datos de carácter personal de los pacientes (nombre, teléfono). Según el **Reglamento (UE) 2016/679 (RGPD)** y la **LOPDGDD**, es obligatorio firmar un Contrato de Encargado de Tratamiento (DPA — Data Processing Agreement) antes de cualquier tratamiento de datos.

**Partes**:
- **Responsable del Tratamiento**: La clínica (quien decide el fin y los medios del tratamiento).
- **Encargado del Tratamiento**: GXA Studio (quien accede a los datos para prestar el servicio).

**Cláusulas mínimas que debe cubrir el contrato** (Art. 28 RGPD):

| Cláusula | Descripción |
|---|---|
| Objeto y duración | Prestación del servicio de gestión de reservas durante la vigencia del contrato |
| Naturaleza y finalidad | Almacenamiento y procesamiento de nombre y teléfono de pacientes para la gestión de citas |
| Tipo de datos | Datos identificativos (nombre completo) y de contacto (número de teléfono móvil E.164) |
| Instrucciones del responsable | GXA Studio solo trata los datos según las instrucciones escritas de la clínica |
| Confidencialidad | Todo el personal de GXA con acceso firma NDA o cláusula de confidencialidad |
| Medidas de seguridad | Cifrado en tránsito (TLS), cifrado en reposo (Supabase), acceso por roles (RLS), OTP hasheado con HMAC-SHA256 |
| Subencargados | Declarar: Supabase (BD), Vercel (hosting), Twilio (mensajería), Upstash (cache) — todos con sus propios DPA firmados |
| Derechos de los interesados | GXA asistirá a la clínica en el ejercicio de derechos ARCO de sus pacientes |
| Notificación de brechas | GXA notificará a la clínica en ≤ 72 h desde el conocimiento de cualquier brecha |
| Devolución/destrucción de datos | Al terminar el contrato, GXA facilitará exportación de datos y procederá a su eliminación segura |

**Procedimiento de firma**:
1. Enviar el DPA por email al responsable legal de la clínica.
2. Firma mediante **Docusign** o **SignNow** (firma electrónica con validez legal en España).
3. Guardar copia firmada en PDF en la carpeta del cliente en GDrive. **Retención mínima: 6 años** (Art. 30 RGPD).

> ⚠️ **Regla**: El DPA firmado es condición sine qua non para crear cualquier instancia de base de datos con datos del cliente o configurar Twilio con su número. Sin DPA, **STOP**.

---

## FASE 1 — Infraestructura de Comunicaciones (Twilio)

**Responsable**: Equipo Técnico GXA Studio  
**Duración estimada**: 2–4 horas (Vía A) / 1–5 días laborables (Vía B, depende de Twilio/Meta)  
**Prerequisito**: Fase 0 completada (DPA firmado + Setup cobrado).

---

### 1.1 Salida del Entorno Sandbox

El entorno **Twilio Sandbox** solo permite enviar mensajes a números que previamente han enviado el código de unión al sandbox (`join <palabra>`). Es exclusivo para desarrollo y pruebas, y **nunca debe usarse en producción con datos de pacientes reales**.

**Pasos para salir del Sandbox**:

1. Acceder a [console.twilio.com](https://console.twilio.com) con las credenciales de la cuenta de la clínica (o de la cuenta GXA Studio que gestiona el tenant).
2. Navegar a **Messaging → WhatsApp → Senders**.
3. Completar el proceso de verificación de cuenta de Twilio (si no está verificado):
   - Verificar identidad del negocio (nombre legal, dirección, EIN/NIF).
   - Puede requerir 1–2 días laborables.
4. Confirmar que `TWILIO_ACCOUNT_SID` y `TWILIO_AUTH_TOKEN` del `.env` corresponden a la cuenta de producción, **no** a la de sandbox.

---

### 1.2 Adquisición del Número de WhatsApp

Elegir **una** de las dos vías según la situación de la clínica:

---

#### Vía A: Comprar un Número Nuevo en Twilio *(más rápida, 2–4 horas)*

Recomendada cuando la clínica no tiene número de WhatsApp Business previo o acepta operar con un número nuevo.

**Pasos**:

1. En Twilio Console → **Phone Numbers → Buy a Number**.
2. Filtrar por país (España → prefijo `+34`) y habilitar capacidades **SMS** y **WhatsApp**.
3. Seleccionar un número local o móvil. Coste orientativo: ~1 $/mes.
4. Una vez comprado, ir a **Messaging → WhatsApp → Senders → Add Sender**.
5. Vincular el número recién comprado como sender de WhatsApp.
6. Twilio iniciará el proceso de verificación con Meta (WhatsApp Business API):
   - Requiere nombre de empresa, web y categoría de negocio (Healthcare).
   - Tiempo de aprobación: **2–5 días laborables** (Meta puede solicitar información adicional).
7. Mientras se aprueba, actualizar `.env` de Vercel:
   ```
   TWILIO_PHONE_NUMBER=+34XXXXXXXXX      # número comprado
   TWILIO_WHATSAPP_FROM=whatsapp:+34XXXXXXXXX
   ```
8. Actualizar el valor `WHATSAPP_FROM` en `lib/twilio/client.ts` (línea 24) con el nuevo número.

> 📝 **Nota**: Hasta que Meta apruebe el número, los mensajes de WhatsApp no se entregarán. Los mensajes SMS (OTP) funcionan inmediatamente tras la compra.

---

#### Vía B: Conectar el Número Actual de la Clínica *(portabilidad / WABA)*

Recomendada cuando la clínica ya tiene un número de WhatsApp Business y quiere conservarlo para mantener el historial de conversaciones y el reconocimiento de los pacientes.

**Prerrequisitos por parte de la clínica**:
- El número debe ser un número de teléfono móvil activo (no puede ser un número de WhatsApp Business API ya registrado en otro proveedor sin migración).
- La clínica debe tener acceso al número para recibir el SMS/llamada de verificación.
- Deben aceptar las [Políticas de WhatsApp Business](https://www.whatsapp.com/legal/business-policy/).

**Pasos**:

1. La clínica crea (o proporciona acceso a) una **cuenta de Facebook Business Manager** verificada.
2. En Twilio Console → **Messaging → WhatsApp → Senders → Add Existing Number**.
3. Twilio redirige al flujo de **Meta Embedded Signup**. La clínica completa el proceso con su cuenta de Facebook Business.
4. Seleccionar el número existente a migrar. Si el número ya está en WhatsApp personal/Business App:
   - La clínica debe **eliminar la cuenta de WhatsApp** de ese número antes de migrar (esto borra el historial local, no el de los chats de los pacientes).
   - Tiempo de gracia: WhatsApp permite recuperar el número en 30 días si se arrepiente.
5. Meta envía un código de verificación por SMS o llamada al número. La clínica lo introduce en el flujo.
6. Aprobación de Meta: **2–7 días laborables** dependiendo del nivel de verificación del Business Manager.
7. Una vez aprobado, actualizar `.env` en Vercel y `lib/twilio/client.ts` exactamente igual que en Vía A.

> ⚠️ **Advertencia**: La Vía B es irreversible a corto plazo. Una vez migrado el número a la WhatsApp Business API, no se puede usar en WhatsApp personal o la app estándar de Business simultáneamente. Informar a la clínica de esto por escrito antes de proceder.

---

### 1.3 Configuración de Variables de Twilio en Vercel

Una vez disponible el número aprobado, actualizar en **Vercel Dashboard → Project → Settings → Environment Variables**:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+34XXXXXXXXX
TWILIO_WHATSAPP_FROM=whatsapp:+34XXXXXXXXX
```

Hacer un redeploy para que las nuevas variables surtan efecto.

---

## FASE 2 — Despliegue Web y Dominios (Vercel)

**Responsable**: Equipo Técnico GXA Studio  
**Duración estimada**: 1–2 horas (Vía A) / 2–4 horas (Vía B, incluyendo propagación DNS)  
**Prerequisito**: Fase 0 completada.

---

### 2.1 Creación de la Instancia en Vercel

1. Acceder a [vercel.com](https://vercel.com) con la cuenta de GXA Studio.
2. **New Project → Import Git Repository** → seleccionar el repositorio `medical-booking-boilerplate`.
3. Nombre del proyecto: usar el slug de la clínica (ej. `clinica-nombre`).
4. Framework preset: **Next.js** (auto-detectado).
5. No desplegar todavía — configurar variables de entorno primero (ver §3.4).

---

### 2.2 Enrutamiento y Dominio

Elegir **una** de las dos vías:

---

#### Vía A (Recomendada): Subdominio en la Web Actual de la Clínica

La clínica ya tiene su web (ej. `clinica-nombre.com`) y quiere que las reservas vivan en `reservas.clinica-nombre.com`. Es la opción más profesional: el paciente percibe continuidad de marca.

**Pasos**:

1. En Vercel → Project → **Settings → Domains → Add**.
2. Introducir el subdominio: `reservas.clinica-nombre.com`.
3. Vercel proporcionará un valor **CNAME** (normalmente `cname.vercel-dns.com`).
4. La clínica (o su proveedor de hosting/DNS) debe crear el registro CNAME:
   ```
   Tipo:  CNAME
   Host:  reservas
   Valor: cname.vercel-dns.com
   TTL:   3600 (o el mínimo que permita el proveedor)
   ```
5. Propagación DNS: **5 minutos – 48 horas** (normalmente < 1 hora con TTL bajo).
6. Vercel emite automáticamente el certificado SSL (Let's Encrypt). Verificar que aparece el candado verde.
7. Actualizar la variable de entorno:
   ```
   NEXT_PUBLIC_APP_URL=https://reservas.clinica-nombre.com
   ```

**Comunicación al responsable de IT de la clínica** (plantilla de email):

> *"Para completar la configuración técnica necesitamos que vuestro proveedor de DNS añada el siguiente registro:*  
> *Tipo: CNAME | Host: reservas | Valor: cname.vercel-dns.com | TTL: 3600*  
> *Si necesitáis asistencia, el proceso tarda menos de 5 minutos en paneles como GoDaddy, Namecheap o el cPanel de vuestro hosting. Estaremos disponibles por WhatsApp para guiaros en tiempo real."*

---

#### Vía B: Compra de Dominio Nuevo

Cuando la clínica no tiene web o prefiere un dominio específico para las reservas (ej. `citas-clinica-nombre.com`).

**Pasos**:

1. Comprar el dominio en **Namecheap**, **Porkbun** o directamente en **Vercel Domains** (lo más simple: Vercel gestiona el DNS automáticamente).
   - Coste orientativo: 10–15 €/año para `.com` o `.es`.
   - Facturar este coste al cliente (pass-through) o incluirlo en el precio de setup.

2. Si se compra en Vercel:
   - Vercel → Project → **Settings → Domains → Buy Domain**.
   - Introducir `citas-clinica-nombre.com` y seguir el flujo de compra.
   - El DNS queda configurado automáticamente. Saltar al paso 5.

3. Si se compra en un registrar externo (Namecheap, etc.):
   - En el panel del registrar, cambiar los **nameservers** al DNS de Vercel:
     ```
     ns1.vercel-dns.com
     ns2.vercel-dns.com
     ```
   - O añadir un registro A apuntando a la IP de Vercel (menos recomendable que delegar NS completo).

4. En Vercel → Project → **Settings → Domains → Add**: añadir el dominio raíz `citas-clinica-nombre.com` y el www si se requiere.

5. Verificar SSL activo y actualizar:
   ```
   NEXT_PUBLIC_APP_URL=https://citas-clinica-nombre.com
   ```

> 📝 **Nota**: Aunque el dominio sea nuevo, siempre recomendamos la Vía A si la clínica tiene web. Un subdominio hereda la reputación del dominio padre, lo que beneficia la entregabilidad de emails y la confianza del paciente.

---

## FASE 3 — Setup de Base de Datos y White-Glove Service

**Responsable**: Equipo Técnico GXA Studio  
**Duración estimada**: 2–3 horas (incluido volcado de datos)  
**Prerequisito**: Fases 0 y 1 completadas. Datos de la clínica recibidos en Excel.

---

### 3.1 Creación de la Instancia en Supabase

Este software sigue un modelo **single-tenant**: un proyecto de Supabase por clínica. Esto garantiza aislamiento total de datos entre clientes.

1. Acceder a [supabase.com](https://supabase.com) con la cuenta de organización de GXA Studio.
2. **New Project**:
   - **Name**: `mbb-[slug-clinica]` (ej. `mbb-clinica-nombre`).
   - **Database Password**: generar una contraseña aleatoria robusta (≥ 32 caracteres). Guardar en el gestor de contraseñas de GXA (Bitwarden / 1Password).
   - **Region**: `eu-central-1` (Frankfurt) para cumplimiento RGPD — los datos nunca salen de la UE.
   - **Plan**: Free tier para empezar; escalar a Pro si el volumen de citas > 500/mes o si se activan recordatorios automáticos (cron).
3. Esperar a que el proyecto se inicialice (~2 minutos).

---

### 3.2 Aplicación del Schema

1. En Supabase → **SQL Editor**, abrir y ejecutar **en orden**:
   ```
   supabase/migrations/20260515_final_schema.sql
   supabase/migrations/20260515_perf_indexes.sql
   supabase/migrations/003_whatsapp_instant_booking.sql
   ```
2. Verificar que no hay errores en ninguna ejecución.
3. Comprobar en **Table Editor** que existen las tablas: `clinics`, `profiles`, `services`, `doctors`, `doctor_services`, `schedules`, `appointments`.
4. Comprobar en **Database → Functions** que existen las RPCs: `book_slot_confirmed`, `get_available_slots`, `reschedule_appointment`, etc.

---

### 3.3 Obtención de Credenciales de Supabase

En Supabase → Project → **Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon key]
SUPABASE_SERVICE_ROLE_KEY=[service_role key]  ← NUNCA exponer públicamente
SUPABASE_PROJECT_ID=[project-ref]
```

Guardar en el gestor de contraseñas de GXA bajo el nombre del cliente.

---

### 3.4 Configuración Completa de Variables de Entorno en Vercel

Con todas las credenciales recopiladas, configurar el bloque completo en **Vercel → Project → Settings → Environment Variables**. Aplicar a los entornos **Production**, **Preview** y **Development**:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://[ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon-key]
SUPABASE_SERVICE_ROLE_KEY=[service-role-key]
SUPABASE_PROJECT_ID=[ref]

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxx
TWILIO_PHONE_NUMBER=+34XXXXXXXXX
TWILIO_WHATSAPP_FROM=whatsapp:+34XXXXXXXXX

# App
NEXT_PUBLIC_APP_URL=https://[dominio-final-cliente]

# Seguridad — generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
OTP_HASH_PEPPER=[32-byte-hex]
INTERNAL_API_SECRET=[32-byte-hex]

# Redis (Upstash — crear proyecto en upstash.com)
UPSTASH_REDIS_REST_URL=https://[ref].upstash.io
UPSTASH_REDIS_REST_TOKEN=[token]

# Cron (dejar vacío hasta activar recordatorios en plan Pro)
# CRON_SECRET=[32-byte-hex]
```

Una vez configuradas todas las variables, hacer **Deploy** desde Vercel.

---

### 3.5 Creación del Registro de la Clínica en BD

En **Supabase → SQL Editor**, insertar el registro de la clínica:

```sql
INSERT INTO public.clinics (name, slug, timezone, phone, address)
VALUES (
  'Nombre Oficial de la Clínica',   -- Nombre que aparecerá en los WhatsApp
  'slug-url-amigable',              -- Solo minúsculas, guiones, sin espacios (ej: clinica-nombre)
  'Europe/Madrid',                  -- IANA timezone — ajustar si la clínica está en Canarias: 'Atlantic/Canary'
  '+34XXXXXXXXX',                   -- Teléfono de contacto de la clínica
  'Calle Ejemplo, 1, 28001 Madrid'  -- Dirección completa
);
```

Anotar el `id` (UUID) generado — se necesitará en los pasos siguientes.

---

### 3.6 White-Glove Service — Volcado Inicial de Datos

El cliente no toca el panel de administración hasta que todo está precargado. GXA Studio se encarga del volcado inicial a partir de un Excel proporcionado por la clínica.

#### 3.6.1 Solicitar el Excel al Cliente

Enviar este email a la clínica:

> *"Para que encuentres todo listo el día del lanzamiento, necesitamos que rellenes esta plantilla con vuestros datos:*
> - **Pestaña 1 — Médicos**: Nombre completo | Especialidad | Email de contacto.
> - **Pestaña 2 — Servicios**: Nombre del servicio | Duración en minutos | Precio (€) | Activo (Sí/No).
> - **Pestaña 3 — Horarios**: Médico | Día de la semana | Hora inicio | Hora fin (puede haber varios bloques por día, ej: 09:00–13:00 y 16:00–20:00).
> - **Pestaña 4 — Vinculación Médico-Servicio**: Médico | Servicios que realiza (columnas o filas).
> 
> Plazo para recibirlo: 24 horas antes de la fecha de lanzamiento acordada."*

#### 3.6.2 Insertar Médicos

```sql
-- Repetir por cada médico
INSERT INTO public.doctors (clinic_id, name, email, specialty, is_active)
VALUES (
  '[clinic-uuid]',
  'Dr. Nombre Apellido',
  'medico@clinica.com',
  'Traumatología',     -- o NULL si no aplica
  true
);
```

#### 3.6.3 Insertar Servicios

```sql
-- Repetir por cada servicio
INSERT INTO public.services (clinic_id, name, duration_minutes, price, is_active)
VALUES (
  '[clinic-uuid]',
  'Consulta General',
  30,      -- duración en minutos
  60.00,   -- precio en EUR (puede ser 0 si no se muestra precio)
  true
);
```

#### 3.6.4 Vincular Médicos con Servicios

```sql
-- Repetir por cada par médico-servicio
INSERT INTO public.doctor_services (doctor_id, service_id)
VALUES ('[doctor-uuid]', '[service-uuid]');
```

#### 3.6.5 Insertar Horarios

```sql
-- Ejemplo: Dr. X con turno mañana y tarde los lunes (day_of_week: 0=domingo, 1=lunes, ..., 6=sábado)
INSERT INTO public.schedules (doctor_id, day_of_week, start_time, end_time, is_active)
VALUES
  ('[doctor-uuid]', 1, '09:00', '13:00', true),  -- Lunes mañana
  ('[doctor-uuid]', 1, '16:00', '20:00', true),  -- Lunes tarde
  ('[doctor-uuid]', 3, '09:00', '13:00', true);  -- Miércoles mañana
```

> ⚠️ **Importante**: los horarios se almacenan en la **hora local de la clínica** (sin UTC). La RPC `get_available_slots` aplica automáticamente la conversión timezone → UTC usando el campo `clinics.timezone`. Asegurarse de que el timezone de la clínica es correcto antes de insertar horarios.

#### 3.6.6 Verificación Final del Volcado

Antes de dar por bueno el volcado, ejecutar en SQL Editor:

```sql
-- Resumen de datos cargados
SELECT
  (SELECT COUNT(*) FROM doctors  WHERE clinic_id = '[clinic-uuid]') AS medicos,
  (SELECT COUNT(*) FROM services WHERE clinic_id = '[clinic-uuid]') AS servicios,
  (SELECT COUNT(*) FROM schedules WHERE doctor_id IN (
    SELECT id FROM doctors WHERE clinic_id = '[clinic-uuid]'
  )) AS bloques_horario,
  (SELECT COUNT(*) FROM doctor_services WHERE doctor_id IN (
    SELECT id FROM doctors WHERE clinic_id = '[clinic-uuid]'
  )) AS vinculaciones;
```

El resultado debe cuadrar con el Excel recibido. Confirmar con el cliente antes de continuar.

---

## FASE 4 — Entrega y Formación (Handoff)

**Responsable**: Equipo Técnico + Comercial GXA Studio  
**Duración estimada**: 30 minutos (15 min setup + 15 min sesión de formación)  
**Prerequisito**: Fases 0–3 completadas. La URL pública está activa y los datos están cargados.

---

### 4.1 Creación de Usuarios Administradores

Por cada miembro del staff de recepción que vaya a usar el panel:

1. En **Supabase → Authentication → Users → Invite User**.
2. Introducir el email del recepcionista/admin de la clínica.
3. Supabase envía un email de invitación con un link de activación (válido 24 horas).
4. El usuario sigue el link, establece su contraseña y queda registrado.
5. El trigger `trg_on_auth_user_created` crea automáticamente su fila en `profiles` con el `clinic_id` correcto.

> 📝 Verificar en **Table Editor → profiles** que el nuevo usuario tiene `clinic_id` asignado correctamente tras activar su cuenta.

---

### 4.2 Verificación End-to-End Previa a la Sesión

Antes de la llamada de formación, el técnico de GXA Studio realiza una prueba completa del sistema:

- [ ] Acceder a `[dominio-cliente]/[slug-clinica]` — se carga el wizard de reservas con los datos reales.
- [ ] Completar una reserva de prueba (usar un número de WhatsApp de GXA como teléfono de paciente).
- [ ] Confirmar que llega el WhatsApp de confirmación con el link `/manage/[token]`.
- [ ] Acceder al link de autogestión — se ven los datos de la cita correctamente.
- [ ] Cancelar la cita de prueba desde el portal del paciente — llega WhatsApp de cancelación.
- [ ] Acceder a `[dominio-cliente]/admin` → login con el usuario admin recién creado.
- [ ] Verificar que la cita cancelada aparece en `/admin/appointments`.
- [ ] Crear una cita manual desde el botón "Nueva cita" (simular llamada telefónica) — llega WhatsApp al número de prueba.

**Si algún check falla**: resolver antes de la sesión de formación. No presentar un sistema roto al cliente.

---

### 4.3 Sesión de Formación (15 minutos)

**Formato**: Videollamada (Google Meet / Zoom) con pantalla compartida. Asistentes: recepción + responsable de la clínica.

**Guión de la sesión**:

| Minuto | Contenido |
|---|---|
| 0–2 | Bienvenida. Mostrar la URL pública de reservas del paciente. Explicar que los pacientes recibirán el link por WhatsApp, web o QR. |
| 2–6 | **Acceso al Admin**: entrar en `/admin`, explicar las secciones del sidebar (Citas, Médicos, Servicios, Horarios). |
| 6–10 | **Vista de Citas**: filtros por estado y fecha, diferencia entre Pendiente/Confirmada/Cancelada, cómo cancelar una cita desde el admin. |
| 10–14 | **Nueva Cita Manual**: hacer una demo en vivo del botón "Nueva cita". Escenario: "Un paciente llama para reservar". Rellenar el formulario, seleccionar médico, servicio, fecha y hora, y mostrar cómo el WhatsApp llega al instante. |
| 14–15 | Preguntas. Entregar el documento "Guía Rápida" (ver §4.4) y los datos de contacto de soporte. |

**Puntos clave a enfatizar**:
- Las citas creadas manualmente son idénticas a las del paciente: el sistema las trata igual, evita colisiones y envía el WhatsApp automáticamente.
- El panel es responsive: funciona desde el móvil de la recepcionista en caso de necesidad.
- El link de autogestión que recibe el paciente (`/manage/[token]`) le permite cancelar o reprogramar por sí mismo sin llamar a la clínica.

---

### 4.4 Entregables del Handoff

Al terminar la sesión, enviar por email a la clínica:

1. **URL del panel de administración**: `https://[dominio-cliente]/admin`
2. **URL del wizard de reservas para pacientes**: `https://[dominio-cliente]/[slug-clinica]`
3. **Credenciales de acceso** (email ya lo conocen, contraseña la pusieron ellos en la activación).
4. **Guía Rápida de Uso** (1 página PDF): cómo ver citas, cómo crear una cita manual, cómo cancelar.
5. **Canal de soporte**: email de soporte GXA Studio + número de WhatsApp para incidencias urgentes.
6. **SLA de soporte**: definir los tiempos de respuesta según el plan contratado.

---

## Checklist de Cierre de Proyecto

Marcar cada ítem antes de dar el proyecto por entregado:

### Fase 0
- [ ] Cuota de Setup cobrada y factura emitida
- [ ] DPA (Contrato Encargado de Tratamiento) firmado y archivado en GDrive (retención 6 años)
- [ ] Confirmación escrita de contratación

### Fase 1
- [ ] Cuenta Twilio en modo producción (fuera de Sandbox)
- [ ] Número de WhatsApp aprobado por Meta
- [ ] Variables `TWILIO_*` configuradas en Vercel y testeadas

### Fase 2
- [ ] Instancia de Vercel creada y desplegada sin errores
- [ ] Dominio configurado con SSL activo (candado verde)
- [ ] `NEXT_PUBLIC_APP_URL` apuntando al dominio definitivo

### Fase 3
- [ ] Proyecto Supabase creado en región `eu-central-1`
- [ ] Schema aplicado (3 migraciones en orden)
- [ ] Registro de clínica insertado en tabla `clinics`
- [ ] Médicos, servicios, horarios y vinculaciones volcados y verificados contra el Excel
- [ ] Todas las variables de entorno configuradas en Vercel (incluidas Redis)
- [ ] Prueba end-to-end completada por el técnico de GXA (reserva + WhatsApp + admin)

### Fase 4
- [ ] Usuario(s) admin creados y activados
- [ ] Sesión de formación celebrada
- [ ] Entregables enviados por email al cliente

### Post-entrega
- [ ] Actualizar `PROJECT_STATE.md` con los datos del nuevo tenant (o crear ficha de cliente)
- [ ] Crear tarea recurrente en el CRM para seguimiento a los 7 días del lanzamiento
- [ ] Documentar cualquier incidencia o particularidad del despliegue para futuras referencias

---

## Contactos y Escalado

| Situación | Acción |
|---|---|
| Problema de DNS (> 48 h sin propagar) | Contactar al registrar del cliente; verificar TTL y que no hay conflicto con registros A previos |
| Meta rechaza el número de WhatsApp | Revisar las políticas de WhatsApp Business; completar la verificación de empresa en Facebook Business Manager |
| Error en la migración SQL | Revisar si el schema ya está parcialmente aplicado (ejecutar con `IF NOT EXISTS`); contactar Supabase support si es error de plataforma |
| Cliente necesita cambiar horarios/servicios tras el lanzamiento | Formarle en el uso del admin: pueden gestionarlo ellos mismos desde `/admin/schedules` y `/admin/services` |
| Incidencia crítica en producción | Canal de guardia GXA Studio — escalado inmediato al responsable técnico |

---

*Documento elaborado por GXA Studio — Uso interno. No distribuir al cliente.*
