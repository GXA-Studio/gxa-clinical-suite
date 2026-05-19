'use client'

import { useState, useMemo } from 'react'
import { fromZonedTime } from 'date-fns-tz'
import { User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NewAppointmentDialog } from '@/components/admin/new-appointment-dialog'

// ─── Grid constants ────────────────────────────────────────────────────────────
const GRID_START_HOUR   = 8
const GRID_END_HOUR     = 21
const SLOT_MINUTES      = 30
const SLOT_HEIGHT_PX    = 52
const TIME_COL_W        = 64
const DOCTOR_COL_MIN_W  = 172
const TOTAL_SLOTS       = (GRID_END_HOUR - GRID_START_HOUR) * (60 / SLOT_MINUTES) // 26

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface GridDoctor {
  id: string
  name: string
  specialty: string | null
  doctor_services: { service_id: string }[]
}

export interface GridSchedule {
  id: string
  doctor_id: string
  day_of_week: number
  start_time: string   // "HH:MM" in clinic local TZ
  end_time: string     // "HH:MM" in clinic local TZ
  is_active: boolean
}

export interface GridAppointment {
  id: string
  doctor_id: string
  patient_name: string
  starts_at: string  // UTC ISO
  ends_at: string    // UTC ISO
  status: string
  services: { name: string; duration_minutes: number } | null
}

export interface GridService {
  id: string
  name: string
  duration_minutes: number
}

interface Props {
  date: string       // YYYY-MM-DD (clinic local)
  timezone: string
  doctors: GridDoctor[]
  schedules: GridSchedule[]
  appointments: GridAppointment[]
  services: GridService[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Get local hour/minute from a UTC ISO string using Intl (no DST drift). */
function getLocalHM(utcIso: string, tz: string): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcIso))

  return {
    h: parseInt(parts.find(p => p.type === 'hour')!.value),
    m: parseInt(parts.find(p => p.type === 'minute')!.value),
  }
}

/** Convert a slot index + date (clinic local) to a UTC ISO string. */
function slotIndexToUtcIso(date: string, slotIndex: number, tz: string): string {
  const totalMins = GRID_START_HOUR * 60 + slotIndex * SLOT_MINUTES
  const h  = Math.floor(totalMins / 60)
  const m  = totalMins % 60
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  // fromZonedTime treats the string as clinic-local and returns UTC
  return fromZonedTime(`${date}T${hh}:${mm}:00`, tz).toISOString()
}

/** True if the slot (by 0-based index) falls within any active schedule block. */
function isSlotWorking(slotIndex: number, blocks: GridSchedule[]): boolean {
  const slotStart = slotIndex * SLOT_MINUTES  // minutes from GRID_START_HOUR
  return blocks.some(b => {
    const [bh, bm] = b.start_time.split(':').map(Number)
    const [eh, em] = b.end_time.split(':').map(Number)
    const blockStart = (bh - GRID_START_HOUR) * 60 + bm
    const blockEnd   = (eh - GRID_START_HOUR) * 60 + em
    return slotStart >= blockStart && slotStart < blockEnd
  })
}

// Precomputed slot metadata (stable — no deps)
const SLOTS = Array.from({ length: TOTAL_SLOTS }, (_, i) => {
  const totalMins = GRID_START_HOUR * 60 + i * SLOT_MINUTES
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  return {
    h,
    m,
    isHour: m === 0,
    label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
  }
})

// ─── Component ─────────────────────────────────────────────────────────────────
export function DailyResourceGrid({
  date,
  timezone,
  doctors,
  schedules,
  appointments,
  services,
}: Props) {
  const [dialogPrefill, setDialogPrefill] = useState<null | {
    doctorId: string
    date: string
    startsAt: string
  }>(null)

  // ── Derived maps ──────────────────────────────────────────────────────────────
  const schedulesByDoctor = useMemo(() => {
    const map = new Map<string, GridSchedule[]>()
    for (const s of schedules) {
      if (!s.is_active) continue
      if (!map.has(s.doctor_id)) map.set(s.doctor_id, [])
      map.get(s.doctor_id)!.push(s)
    }
    return map
  }, [schedules])

  const apptsByDoctor = useMemo(() => {
    const map = new Map<string, GridAppointment[]>()
    for (const a of appointments) {
      if (a.status === 'cancelled') continue
      if (!map.has(a.doctor_id)) map.set(a.doctor_id, [])
      map.get(a.doctor_id)!.push(a)
    }
    return map
  }, [appointments])

  // ── Handlers ──────────────────────────────────────────────────────────────────
  function handleCellClick(doctorId: string, slotIndex: number) {
    setDialogPrefill({
      doctorId,
      date,
      startsAt: slotIndexToUtcIso(date, slotIndex, timezone),
    })
  }

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (doctors.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white">
        <p className="text-sm text-muted-foreground">No hay médicos activos para mostrar.</p>
      </div>
    )
  }

  const totalGridHeight  = TOTAL_SLOTS * SLOT_HEIGHT_PX
  const minGridWidth     = TIME_COL_W + doctors.length * DOCTOR_COL_MIN_W

  return (
    <>
      {/*
       * Single overflow:auto container — both axes.
       * sticky top-0 and sticky left-0 work relative to this single scroll context.
       */}
      <div
        className="overflow-auto rounded-lg border border-slate-200 bg-white"
        style={{ maxHeight: 'calc(100svh - 11rem)' }}
      >
        {/* Inner min-width wrapper so horizontal scroll kicks in when needed */}
        <div style={{ minWidth: `${minGridWidth}px` }}>

          {/* ── Sticky header row ──────────────────────────────────────────── */}
          <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-white shadow-sm">
            {/* Top-left corner — must be sticky in BOTH directions */}
            <div
              className="sticky left-0 z-30 shrink-0 border-r border-slate-200 bg-white"
              style={{ width: TIME_COL_W }}
            />

            {/* Doctor header cells */}
            {doctors.map(doc => {
              const hasSchedule = (schedulesByDoctor.get(doc.id) ?? []).length > 0
              return (
                <div
                  key={doc.id}
                  className="flex flex-col justify-center border-r border-slate-200 px-3 py-2.5 last:border-r-0"
                  style={{ minWidth: DOCTOR_COL_MIN_W, flex: 1 }}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <User className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{doc.name}</p>
                      {doc.specialty && (
                        <p className="truncate text-[11px] text-slate-400">{doc.specialty}</p>
                      )}
                    </div>
                  </div>
                  {!hasSchedule && (
                    <p className="mt-0.5 pl-9 text-[10px] text-amber-500">Sin horario este día</p>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Grid body ──────────────────────────────────────────────────── */}
          <div className="flex">
            {/* Sticky time-label column */}
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-slate-200 bg-slate-50"
              style={{ width: TIME_COL_W, height: totalGridHeight }}
            >
              {SLOTS.map((slot, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-start justify-end border-b pr-2 pt-1',
                    slot.isHour ? 'border-slate-200' : 'border-slate-100'
                  )}
                  style={{ height: SLOT_HEIGHT_PX }}
                >
                  {slot.isHour ? (
                    <span className="text-[11px] font-medium tabular-nums text-slate-500">
                      {slot.label}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-300">·</span>
                  )}
                </div>
              ))}
            </div>

            {/* Doctor columns */}
            {doctors.map(doc => {
              const docSchedules = schedulesByDoctor.get(doc.id) ?? []
              const docAppts     = apptsByDoctor.get(doc.id) ?? []

              return (
                <div
                  key={doc.id}
                  className="relative border-r border-slate-200 last:border-r-0"
                  style={{
                    minWidth: DOCTOR_COL_MIN_W,
                    flex: 1,
                    height: totalGridHeight,
                  }}
                >
                  {/* ── Background / click cells ─────────────────────────── */}
                  {SLOTS.map((slot, i) => {
                    const working = isSlotWorking(i, docSchedules)
                    return (
                      <div
                        key={i}
                        className={cn(
                          'absolute inset-x-0 border-b transition-colors',
                          slot.isHour ? 'border-slate-200' : 'border-slate-100',
                          working
                            ? 'cursor-pointer bg-white hover:bg-blue-50/60 active:bg-blue-100/70'
                            : 'cursor-default'
                        )}
                        style={{
                          top: i * SLOT_HEIGHT_PX,
                          height: SLOT_HEIGHT_PX,
                          // Hatched pattern for non-working hours
                          ...(!working && {
                            backgroundColor: 'rgb(241 245 249)',
                            backgroundImage:
                              'repeating-linear-gradient(45deg,transparent,transparent 6px,rgba(148,163,184,0.15) 6px,rgba(148,163,184,0.15) 12px)',
                          }),
                        }}
                        onClick={() => working && handleCellClick(doc.id, i)}
                      />
                    )
                  })}

                  {/* ── Appointment cards ─────────────────────────────────── */}
                  {docAppts.map(appt => {
                    const { h: sh, m: sm } = getLocalHM(appt.starts_at, timezone)
                    const { h: eh, m: em } = getLocalHM(appt.ends_at,   timezone)

                    const startMinsFromGrid = (sh - GRID_START_HOUR) * 60 + sm
                    const durationMins      = (eh - GRID_START_HOUR) * 60 + em - startMinsFromGrid
                    const topPx             = (startMinsFromGrid / SLOT_MINUTES) * SLOT_HEIGHT_PX
                    const heightPx          = Math.max(
                      SLOT_HEIGHT_PX * 0.85,
                      (durationMins / SLOT_MINUTES) * SLOT_HEIGHT_PX - 4
                    )
                    const serviceName = appt.services?.name ?? ''

                    return (
                      <div
                        key={appt.id}
                        className="absolute left-1 right-1 z-10 overflow-hidden rounded-md border border-blue-200 bg-blue-50 px-2 py-1 shadow-sm"
                        style={{ top: topPx + 2, height: heightPx }}
                        title={`${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')} · ${appt.patient_name}${serviceName ? ` · ${serviceName}` : ''}`}
                      >
                        <p className="truncate text-[11px] font-semibold leading-tight text-blue-800">
                          {String(sh).padStart(2,'0')}:{String(sm).padStart(2,'0')} · {appt.patient_name}
                        </p>
                        {heightPx > 36 && serviceName && (
                          <p className="truncate text-[10px] leading-tight text-blue-500">{serviceName}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Controlled dialog opened from grid cell clicks */}
      {dialogPrefill && (
        <NewAppointmentDialog
          doctors={doctors as Parameters<typeof NewAppointmentDialog>[0]['doctors']}
          services={services}
          open={true}
          onOpenChange={open => { if (!open) setDialogPrefill(null) }}
          prefill={dialogPrefill}
        />
      )}
    </>
  )
}
