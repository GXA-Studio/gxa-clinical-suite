/**
 * E2E — Admin Panel: Performance & Critical Flows
 *
 * Environment groups:
 *   OFFLINE  — only a running dev server needed (no Supabase credentials).
 *              Tests unauthenticated redirect and login-page UI.
 *
 *   AUTHED   — require ADMIN_EMAIL + ADMIN_PASSWORD env vars.
 *              Tests the full admin panel: load, filters, "Nueva cita" dialog.
 *              Run against production: PLAYWRIGHT_BASE_URL=https://... npx playwright test
 *
 * Key performance assertions:
 *   - Admin shell (sidebar) visible in < 3 s
 *   - Appointments table visible in < 6 s
 *   - bookAppointmentManual server action returns in < 4 s (Twilio now deferred via after())
 */

import { test, expect, type Page } from '@playwright/test'

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    ?? ''
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ''
const HAS_CREDS      = !!(ADMIN_EMAIL && ADMIN_PASSWORD)

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loginAsAdmin(page: Page) {
  await page.goto('/auth/login')
  await page.getByLabel(/correo electrónico/i).fill(ADMIN_EMAIL)
  await page.getByLabel(/contraseña/i).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /acceder/i }).click()
  // Wait for redirect into admin
  await page.waitForURL(/\/admin/, { timeout: 15_000 })
}

/** Mock the /api/slots endpoint so dialog tests never hit real Supabase */
async function mockSlotsApi(page: Page) {
  const futureSlots = [
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z'),
    new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z'),
  ]
  await page.route('**/api/slots**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ slots: futureSlots }),
    })
  )
}

// ─── OFFLINE tests (no credentials required) ─────────────────────────────────

test.describe('Auth — unauthenticated access', () => {

  test('GET /admin redirects unauthenticated user to /auth/login', async ({ page }) => {
    const res = await page.goto('/admin/appointments', { waitUntil: 'commit' })
    // Either a redirect lands us on /auth/login, or the response itself is a redirect
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 })
    // The redirect should carry the intended destination
    expect(page.url()).toContain('redirectTo')
  })

  test('Login page renders email + password fields and submit button', async ({ page }) => {
    await page.goto('/auth/login')
    await expect(page.locator('#email')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await expect(page.getByRole('button', { name: /acceder/i })).toBeVisible()
  })

  test('Login inputs have required attribute preventing empty submission', async ({ page }) => {
    await page.goto('/auth/login')
    // The form uses HTML required — inputs must carry the attribute
    await expect(page.locator('#email[required]')).toHaveCount(1)
    await expect(page.locator('#password[required]')).toHaveCount(1)
  })

})

// ─── AUTHED tests (require ADMIN_EMAIL + ADMIN_PASSWORD) ─────────────────────

test.describe('Admin Panel — appointments page', () => {

  test.skip(!HAS_CREDS, 'Set ADMIN_EMAIL + ADMIN_PASSWORD to run authenticated admin tests')

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/appointments')
  })

  test('Admin shell (sidebar) is visible under 3 s', async ({ page }) => {
    const t0 = Date.now()
    await page.goto('/admin/appointments')
    // Sidebar nav link for "Citas" should appear inside the shell
    await expect(page.getByRole('link', { name: /citas/i }).first()).toBeVisible({ timeout: 3_000 })
    const elapsed = Date.now() - t0
    console.log(`[PERF] Admin shell visible in ${elapsed} ms`)
    expect(elapsed).toBeLessThan(3_000)
  })

  test('Appointments table or empty state renders under 6 s', async ({ page }) => {
    const t0 = Date.now()
    await page.goto('/admin/appointments')
    // Either a table row, the empty-state message, or the stats strip is acceptable
    const tableOrEmpty = page.locator(
      'table, [data-testid="appointments-empty"], .grid'
    ).first()
    await expect(tableOrEmpty).toBeVisible({ timeout: 6_000 })
    const elapsed = Date.now() - t0
    console.log(`[PERF] Appointments content visible in ${elapsed} ms`)
    expect(elapsed).toBeLessThan(6_000)
  })

  test('Status filter — selecting "Confirmadas" updates the URL', async ({ page }) => {
    // Open the status filter dropdown
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /confirmadas/i }).click()
    await expect(page).toHaveURL(/status=confirmed/, { timeout: 5_000 })
  })

  test('Status filter — "Limpiar filtros" resets to base URL', async ({ page }) => {
    // Apply a filter first
    await page.goto('/admin/appointments?status=confirmed')
    await expect(page.getByRole('button', { name: /limpiar filtros/i })).toBeVisible({ timeout: 5_000 })
    await page.getByRole('button', { name: /limpiar filtros/i }).click()
    await expect(page).toHaveURL(/\/admin\/appointments$/, { timeout: 5_000 })
    await expect(page.getByRole('button', { name: /limpiar filtros/i })).not.toBeVisible()
  })

  test('Date filter — entering a date appends it to the URL', async ({ page }) => {
    const tomorrow = new Intl.DateTimeFormat('en-CA').format(
      new Date(Date.now() + 86_400_000)
    )
    await page.locator('input[type="date"]').fill(tomorrow)
    await expect(page).toHaveURL(new RegExp(`date=${tomorrow}`), { timeout: 5_000 })
  })

})

// ─── AUTHED tests — "Nueva cita" dialog ──────────────────────────────────────

test.describe('Admin Panel — Nueva cita dialog', () => {

  test.skip(!HAS_CREDS, 'Set ADMIN_EMAIL + ADMIN_PASSWORD to run authenticated admin tests')

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/appointments')
  })

  test('Dialog opens when "Nueva cita" is clicked', async ({ page }) => {
    await page.getByRole('button', { name: /nueva cita/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/crear cita manualmente/i)).toBeVisible()
  })

  test('Dialog closes and resets when "Cancelar" is clicked', async ({ page }) => {
    await page.getByRole('button', { name: /nueva cita/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Fill some fields so we can confirm they're reset
    await page.getByPlaceholder(/Ana García/i).fill('Test Paciente')

    await page.getByRole('button', { name: /cancelar/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3_000 })

    // Reopening should show empty fields
    await page.getByRole('button', { name: /nueva cita/i }).click()
    await expect(page.getByPlaceholder(/Ana García/i)).toHaveValue('')
  })

  test('Confirm button is disabled until all required fields are filled', async ({ page }) => {
    await page.getByRole('button', { name: /nueva cita/i }).click()
    const confirmBtn = page.getByRole('button', { name: /^crear cita$/i })
    await expect(confirmBtn).toBeDisabled()
  })

  test('Slots are fetched when doctor + service + date are all selected', async ({ page }) => {
    await mockSlotsApi(page)
    await page.getByRole('button', { name: /nueva cita/i }).click()

    // We need at least one doctor and service available — skip if the DB is empty
    const doctorSelect = page.locator('[role="combobox"]').nth(0)
    await doctorSelect.click()
    const firstDoctor = page.getByRole('option').first()
    const doctorCount = await page.getByRole('option').count()
    if (doctorCount === 0) {
      test.skip()
      return
    }
    await firstDoctor.click()

    const serviceSelect = page.locator('[role="combobox"]').nth(1)
    await serviceSelect.click()
    const firstService = page.getByRole('option').first()
    const serviceCount = await page.getByRole('option').count()
    if (serviceCount === 0) {
      test.skip()
      return
    }
    await firstService.click()

    // The date is pre-filled with today — slots should load automatically
    await expect(page.locator('text=/cargando horarios/i, text=/no hay horarios/i').first()).not.toBeVisible({ timeout: 2_000 }).catch(() => {})
    // Slot buttons OR no-availability message must appear within 5 s
    const slotsOrEmpty = page.locator(
      'button[type="button"]:has-text(/\\d{2}:\\d{2}/), text=/no hay horarios/i'
    ).first()
    await expect(slotsOrEmpty).toBeVisible({ timeout: 5_000 })
  })

})

// ─── AUTHED tests — bookAppointmentManual performance ────────────────────────

test.describe('Admin Panel — bookAppointmentManual server action latency', () => {

  test.skip(!HAS_CREDS, 'Set ADMIN_EMAIL + ADMIN_PASSWORD to run authenticated admin tests')

  test('Server action resolves in under 4 s (Twilio deferred via after())', async ({ page }) => {
    await loginAsAdmin(page)
    await mockSlotsApi(page)
    await page.goto('/admin/appointments')

    await page.getByRole('button', { name: /nueva cita/i }).click()

    const doctorSelect = page.locator('[role="combobox"]').nth(0)
    await doctorSelect.click()
    const doctorCount = await page.getByRole('option').count()
    if (doctorCount === 0) { test.skip(); return }
    await page.getByRole('option').first().click()

    const serviceSelect = page.locator('[role="combobox"]').nth(1)
    await serviceSelect.click()
    const serviceCount = await page.getByRole('option').count()
    if (serviceCount === 0) { test.skip(); return }
    await page.getByRole('option').first().click()

    // Wait for slots to load (mocked)
    const slotBtn = page.locator('button[type="button"]').filter({ hasText: /\d{2}:\d{2}/ }).first()
    await expect(slotBtn).toBeVisible({ timeout: 5_000 })
    await slotBtn.click()

    // Fill patient info
    await page.getByPlaceholder(/Ana García/i).fill('E2E Prueba')
    await page.getByPlaceholder(/\+34612/i).fill('+34600000001')

    const confirmBtn = page.getByRole('button', { name: /^crear cita$/i })
    await expect(confirmBtn).toBeEnabled({ timeout: 2_000 })

    const t0 = Date.now()
    await confirmBtn.click()

    // Either success toast or error toast should appear within 4 s
    const toast = page.locator('[role="status"], [data-radix-toast-viewport] li').first()
    await expect(toast).toBeVisible({ timeout: 4_000 })
    const elapsed = Date.now() - t0
    console.log(`[PERF] bookAppointmentManual action returned in ${elapsed} ms`)
    expect(elapsed).toBeLessThan(4_000)
  })

})
