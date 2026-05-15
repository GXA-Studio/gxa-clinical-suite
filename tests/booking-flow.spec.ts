/**
 * E2E — Patient Booking Funnel (Time-First flow)
 *
 * Flow: Service → Slot (calendar date + time) → Doctor (if >1) → Patient → Confirmed
 *
 * Works against BOTH environments:
 *   - Local:      PLAYWRIGHT_BASE_URL not set → webServer starts localhost:3000
 *   - Production: PLAYWRIGHT_BASE_URL=https://medical-booking-boilerplate.vercel.app
 *
 * Fixture page (/test-fixture) renders BookingWizard with static clinic data,
 * so NO Supabase database is required for these tests.
 *
 * API routes intercepted via page.route():
 *   GET  /api/available-days → activeDow: [] (all days enabled, no restrictions)
 *   GET  /api/slots          → mock slots with doctor info (Mode B format)
 *   POST /api/book           → returns appointmentId (no DB or Twilio touched)
 */

import { test, expect, type Page } from '@playwright/test'

const FIXTURE_URL = '/test-fixture'

// ─── Mock data ────────────────────────────────────────────────────────────────

// Slots well in the future so the 15-min grace-period filter never hides them
const SLOT_A = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
const SLOT_B = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString()

/** Two doctors → wizard shows the Doctor step */
const MULTI_DOCTOR_SLOTS = {
  slots: [
    {
      start:   SLOT_A,
      doctors: [
        { id: '00000000-0000-0000-0000-000000000020', name: 'Dra. Laura Martínez', specialty: 'Medicina General' },
        { id: '00000000-0000-0000-0000-000000000021', name: 'Dr. Carlos Pérez',    specialty: 'Medicina Familiar' },
      ],
    },
    {
      start:   SLOT_B,
      doctors: [
        { id: '00000000-0000-0000-0000-000000000020', name: 'Dra. Laura Martínez', specialty: 'Medicina General' },
      ],
    },
  ],
}

/** One doctor → wizard skips Doctor step, goes straight to Patient */
const SINGLE_DOCTOR_SLOTS = {
  slots: [
    {
      start:   SLOT_A,
      doctors: [
        { id: '00000000-0000-0000-0000-000000000022', name: 'Dr. Miguel Torres', specialty: 'Cardiología' },
      ],
    },
    {
      start:   SLOT_B,
      doctors: [
        { id: '00000000-0000-0000-0000-000000000022', name: 'Dr. Miguel Torres', specialty: 'Cardiología' },
      ],
    },
  ],
}

// ─── Mock helpers ─────────────────────────────────────────────────────────────

async function setupMocks(page: Page, slots = SINGLE_DOCTOR_SLOTS) {
  // activeDow: [] → disabledMatcher returns false for all future dates (nothing disabled)
  await page.route('**/api/available-days**', (route) =>
    route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify({ activeDow: [] }),
    })
  )
  // Mode-B slot response: array of { start, doctors[] }
  await page.route('**/api/slots**', (route) =>
    route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify(slots),
    })
  )
  // Direct booking (no OTP)
  await page.route('**/api/book', (route) =>
    route.fulfill({
      status:      200,
      contentType: 'application/json',
      body:        JSON.stringify({ appointmentId: 'mock-appt-abc123' }),
    })
  )
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

/** Click the first non-disabled day in the react-day-picker calendar */
async function selectFirstCalendarDay(page: Page) {
  // react-day-picker v9 renders days as <button> inside <td> cells.
  // Only past dates are disabled (attribute "disabled") when activeDow is mocked empty.
  const dayBtn = page.locator('td button:not([disabled])').first()
  await expect(dayBtn).toBeVisible({ timeout: 8_000 })
  await dayBtn.click()
}

/**
 * Once a day is selected, click the first time slot button then the
 * sticky "Confirmar HH:MM" CTA that appears beneath it.
 */
async function selectFirstTimeSlot(page: Page) {
  // Time slot buttons display HH:MM text (formatSlotTime uses 24h, es-ES locale)
  const slotBtn = page.locator('button', { hasText: /^\d{2}:\d{2}$/ }).first()
  await expect(slotBtn).toBeVisible({ timeout: 8_000 })
  await slotBtn.click()

  const confirmBtn = page.locator('button', { hasText: /^Confirmar \d{2}:\d{2}$/ })
  await expect(confirmBtn).toBeVisible()
  await confirmBtn.click()
}

/** Navigate to the Patient step via the single-doctor path (Cardiología). */
async function goToPatientStep(page: Page) {
  await page.goto(FIXTURE_URL)
  await page.getByText('Cardiología').click()
  await expect(page.getByText('Elige fecha y hora')).toBeVisible()
  await selectFirstCalendarDay(page)
  await selectFirstTimeSlot(page)  // single-doctor slot → skips Doctor step
  await expect(page.getByText('Tus datos')).toBeVisible()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Booking Funnel', () => {

  test('Step 1 — service cards are displayed', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    await expect(page.getByText('¿Qué servicio necesitas?')).toBeVisible()
    await expect(page.getByText('Consulta General')).toBeVisible()
    await expect(page.getByText('Cardiología')).toBeVisible()
  })

  test('Step 2 — selecting a service shows the slot calendar', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    await page.getByText('Consulta General').click()

    // Time-First flow: next step is slot calendar, not doctor list
    await expect(page.getByText('Elige fecha y hora')).toBeVisible()
    await expect(page.getByText('Consulta General')).toBeVisible() // service name shown in subtitle
    // Calendar grid must appear (available-days API returns immediately)
    await expect(page.locator('td button').first()).toBeVisible({ timeout: 8_000 })
  })

  test('Step 3 — selecting a calendar day loads time-slot grid', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    await page.getByText('Consulta General').click()
    await expect(page.getByText('Elige fecha y hora')).toBeVisible()

    await selectFirstCalendarDay(page)

    // Time slot buttons (HH:MM) must appear after day selection
    const slotBtn = page.locator('button', { hasText: /^\d{2}:\d{2}$/ }).first()
    await expect(slotBtn).toBeVisible({ timeout: 8_000 })
  })

  test('Step 3b — clicking a time slot shows the Confirmar CTA', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    await page.getByText('Consulta General').click()
    await expect(page.getByText('Elige fecha y hora')).toBeVisible()
    await selectFirstCalendarDay(page)

    const slotBtn = page.locator('button', { hasText: /^\d{2}:\d{2}$/ }).first()
    await expect(slotBtn).toBeVisible({ timeout: 8_000 })
    await slotBtn.click()

    // "Confirmar HH:MM" sticky CTA must appear after slot selection
    await expect(page.locator('button', { hasText: /^Confirmar \d{2}:\d{2}$/ })).toBeVisible()
  })

  test('Step 4 — confirming a slot with multiple doctors shows Elige profesional', async ({ page }) => {
    // Use the multi-doctor slot mock so the wizard enters the Doctor step
    await setupMocks(page, MULTI_DOCTOR_SLOTS)
    await page.goto(FIXTURE_URL)

    await page.getByText('Consulta General').click()
    await expect(page.getByText('Elige fecha y hora')).toBeVisible()
    await selectFirstCalendarDay(page)
    await selectFirstTimeSlot(page)  // first slot has 2 doctors → Doctor step

    await expect(page.getByText('Elige profesional')).toBeVisible()
    await expect(page.getByText('Dra. Laura Martínez')).toBeVisible()
    await expect(page.getByText('Dr. Carlos Pérez')).toBeVisible()
    // "Any doctor" option is always present
    await expect(page.getByText('Cualquier profesional disponible')).toBeVisible()
  })

  test('Step 5 — GDPR checkbox is mandatory to enable the submit button', async ({ page }) => {
    await setupMocks(page)
    await goToPatientStep(page)

    const submitBtn = page.getByRole('button', { name: 'Confirmar cita' })

    // Empty form: disabled
    await expect(submitBtn).toBeDisabled()

    await page.getByLabel('Nombre completo').fill('Ana Prueba García')
    await page.getByLabel('Número de teléfono').fill('+521234567890')

    // Name + phone filled but no GDPR consent: still disabled
    await expect(submitBtn).toBeDisabled()

    // Grant consent
    await page.getByRole('checkbox').check()

    // Now enabled
    await expect(submitBtn).toBeEnabled()
  })

  test('Step 6 — submitting valid patient data goes directly to Confirmed (no OTP)', async ({ page }) => {
    await setupMocks(page)
    await goToPatientStep(page)

    await page.getByLabel('Nombre completo').fill('Ana Prueba García')
    await page.getByLabel('Número de teléfono').fill('+521234567890')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Confirmar cita' }).click()

    // Direct confirmation — no OTP step
    await expect(page.getByText('¡Cita confirmada!')).toBeVisible({ timeout: 10_000 })
  })

  test('Full funnel — happy path end-to-end (Time-First flow)', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    // Step 1: Select service
    await expect(page.getByText('¿Qué servicio necesitas?')).toBeVisible()
    await page.getByText('Cardiología').click()

    // Step 2: Calendar appears
    await expect(page.getByText('Elige fecha y hora')).toBeVisible()
    await selectFirstCalendarDay(page)

    // Step 3: Select time slot + confirm (single doctor → skips Doctor step)
    const slotBtn = page.locator('button', { hasText: /^\d{2}:\d{2}$/ }).first()
    await expect(slotBtn).toBeVisible({ timeout: 8_000 })
    await slotBtn.click()
    await expect(page.locator('button', { hasText: /^Confirmar \d{2}:\d{2}$/ })).toBeVisible()
    await page.locator('button', { hasText: /^Confirmar \d{2}:\d{2}$/ }).click()

    // Step 4: Patient data — submit gated by GDPR consent
    await expect(page.getByText('Tus datos')).toBeVisible()
    const submitBtn = page.getByRole('button', { name: 'Confirmar cita' })
    await expect(submitBtn).toBeDisabled()

    await page.getByLabel('Nombre completo').fill('Carlos E2E')
    await page.getByLabel('Número de teléfono').fill('+521111111111')
    await expect(submitBtn).toBeDisabled()  // phone+name filled, but no consent yet

    await page.getByRole('checkbox').check()
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // Step 5: Confirmed — direct, no OTP
    await expect(page.getByText('¡Cita confirmada!')).toBeVisible({ timeout: 10_000 })
  })

})
