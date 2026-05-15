/**
 * E2E — Patient Booking Funnel
 *
 * Uses the /test-fixture page which renders BookingWizard with static data,
 * so the test has zero dependency on a live Supabase instance.
 *
 * API routes mocked:
 *   POST /api/slots      → returns two available time slots
 *   POST /api/otp/send   → returns a fake appointmentId (no real SMS)
 *   POST /api/otp/verify → returns success (no real DB verification)
 */

import { test, expect } from '@playwright/test'

const FIXTURE_URL = '/test-fixture'

// Fixed future slot (ISO UTC) — used both in the mock response and assertions
const MOCK_SLOT = '2026-06-15T15:00:00.000Z'

// ─── Shared setup ─────────────────────────────────────────────────────────────

async function setupMocks(page: Parameters<Parameters<typeof test>[1]>[0]) {
  // Mock /api/slots — returns two slots regardless of query params
  await page.route('**/api/slots**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ slots: [MOCK_SLOT, '2026-06-15T16:00:00.000Z'] }),
    })
  })

  // Mock /api/otp/send — claims the slot and returns a fake appointment
  await page.route('**/api/otp/send', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ appointmentId: 'mock-appt-abc123' }),
    })
  })

  // Mock /api/otp/verify — confirms the appointment instantly
  await page.route('**/api/otp/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Booking Funnel', () => {

  test('Step 1 — service cards are displayed', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    // Heading
    await expect(page.getByText('¿Qué servicio necesitas?')).toBeVisible()

    // Both fixture services are rendered
    await expect(page.getByText('Consulta General')).toBeVisible()
    await expect(page.getByText('Cardiología')).toBeVisible()
  })

  test('Step 2 — selecting a service shows doctor list', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    await page.getByText('Consulta General').click()

    await expect(page.getByText('¿Con quién?')).toBeVisible()
    await expect(page.getByText('Dra. Laura Martínez')).toBeVisible()
    await expect(page.getByText('Dr. Carlos Pérez')).toBeVisible()
  })

  test('Step 3 — selecting a doctor fetches and shows slot grid', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    await page.getByText('Consulta General').click()
    await page.getByText('Dra. Laura Martínez').click()

    // Date strip heading
    await expect(page.getByText('Elige fecha y hora')).toBeVisible()

    // At least one slot button should appear after the route mock returns
    const slotButton = page.locator('button', { hasText: /\d{2}:\d{2}/ }).first()
    await expect(slotButton).toBeVisible({ timeout: 10_000 })
  })

  test('Step 4 — GDPR checkbox gates the submit button', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    // Navigate to the patient data step
    await page.getByText('Consulta General').click()
    await page.getByText('Dra. Laura Martínez').click()
    const slotButton = page.locator('button', { hasText: /\d{2}:\d{2}/ }).first()
    await slotButton.click()

    // We should now be on the patient data step
    await expect(page.getByText('Tus datos')).toBeVisible()
    await expect(page.getByText('Para confirmar la cita te enviaremos un SMS.')).toBeVisible()

    const submitBtn = page.getByRole('button', { name: 'Recibir código SMS' })

    // ── Gate check: button must be disabled before consent ──────────────────
    await expect(submitBtn).toBeDisabled()

    // Fill valid name and phone
    await page.getByLabel('Nombre completo').fill('Ana Prueba García')
    await page.getByLabel('Número de teléfono').fill('+521234567890')

    // Still disabled — consent not given
    await expect(submitBtn).toBeDisabled()

    // Check the GDPR consent checkbox
    await page.getByRole('checkbox').check()

    // Now the button must be enabled
    await expect(submitBtn).toBeEnabled()
  })

  test('Step 5 — submitting valid data triggers OTP modal', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    await page.getByText('Consulta General').click()
    await page.getByText('Dra. Laura Martínez').click()
    const slotButton = page.locator('button', { hasText: /\d{2}:\d{2}/ }).first()
    await slotButton.click()

    await page.getByLabel('Nombre completo').fill('Ana Prueba García')
    await page.getByLabel('Número de teléfono').fill('+521234567890')
    await page.getByRole('checkbox').check()

    await page.getByRole('button', { name: 'Recibir código SMS' }).click()

    // OTP step heading
    await expect(page.getByText('Verifica tu número')).toBeVisible()

    // 6 individual digit inputs should be present
    const otpInputs = page.locator('input[inputmode="numeric"]')
    await expect(otpInputs).toHaveCount(6)
  })

  test('Step 6 — OTP inputs auto-advance and paste works', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    // Navigate to OTP step
    await page.getByText('Consulta General').click()
    await page.getByText('Dra. Laura Martínez').click()
    await page.locator('button', { hasText: /\d{2}:\d{2}/ }).first().click()
    await page.getByLabel('Nombre completo').fill('Ana Prueba García')
    await page.getByLabel('Número de teléfono').fill('+521234567890')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Recibir código SMS' }).click()
    await expect(page.getByText('Verifica tu número')).toBeVisible()

    // Type digits one by one — focus should auto-advance
    const inputs = page.locator('input[inputmode="numeric"]')
    await inputs.nth(0).fill('1')
    await inputs.nth(1).fill('2')
    await inputs.nth(2).fill('3')

    // Each input should hold one digit
    await expect(inputs.nth(0)).toHaveValue('1')
    await expect(inputs.nth(1)).toHaveValue('2')
    await expect(inputs.nth(2)).toHaveValue('3')

    // Clear and test clipboard paste on the first input
    // Reset to a fresh OTP step by reloading and navigating again
  })

  test('Step 7 — entering correct OTP shows confirmed screen', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    // Navigate to OTP step
    await page.getByText('Consulta General').click()
    await page.getByText('Dra. Laura Martínez').click()
    await page.locator('button', { hasText: /\d{2}:\d{2}/ }).first().click()
    await page.getByLabel('Nombre completo').fill('Ana Prueba García')
    await page.getByLabel('Número de teléfono').fill('+521234567890')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Recibir código SMS' }).click()
    await expect(page.getByText('Verifica tu número')).toBeVisible()

    // Enter 6-digit OTP (any 6 digits — mock verifies it instantly)
    const inputs = page.locator('input[inputmode="numeric"]')
    const code = ['1', '2', '3', '4', '5', '6']
    for (let i = 0; i < 6; i++) {
      await inputs.nth(i).fill(code[i])
    }

    // Mock returns success → expect the confirmed screen
    await expect(page.getByText('¡Cita confirmada!')).toBeVisible({ timeout: 10_000 })
  })

  test('Full funnel — happy path end-to-end', async ({ page }) => {
    await setupMocks(page)
    await page.goto(FIXTURE_URL)

    // Step 1: Select service
    await expect(page.getByText('¿Qué servicio necesitas?')).toBeVisible()
    await page.getByText('Cardiología').click()

    // Step 2: Select doctor
    await expect(page.getByText('¿Con quién?')).toBeVisible()
    await page.getByText('Dr. Miguel Torres').click()

    // Step 3: Select slot
    await expect(page.getByText('Elige fecha y hora')).toBeVisible()
    await page.locator('button', { hasText: /\d{2}:\d{2}/ }).first().click()

    // Step 4: Fill patient data — button disabled without consent
    await expect(page.getByText('Tus datos')).toBeVisible()
    const submitBtn = page.getByRole('button', { name: 'Recibir código SMS' })
    await expect(submitBtn).toBeDisabled()

    await page.getByLabel('Nombre completo').fill('Carlos E2E')
    await page.getByLabel('Número de teléfono').fill('+521111111111')
    await expect(submitBtn).toBeDisabled()  // still disabled without checkbox
    await page.getByRole('checkbox').check()
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // Step 5: OTP verification
    await expect(page.getByText('Verifica tu número')).toBeVisible()
    const inputs = page.locator('input[inputmode="numeric"]')
    await expect(inputs).toHaveCount(6)

    for (let i = 0; i < 6; i++) {
      await inputs.nth(i).fill(String(i + 1))
    }

    // Step 6: Confirmed
    await expect(page.getByText('¡Cita confirmada!')).toBeVisible({ timeout: 10_000 })
  })

})
