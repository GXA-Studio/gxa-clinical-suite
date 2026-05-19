'use client'
import { useState, useMemo, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TimeOfDay } from './types'

const INITIAL_VISIBLE  = 3
const MOBILE_PAGE_SIZE = 3

interface Props {
  slots:       Record<string, string[]>  // YYYY-MM-DD → ISO UTC starts
  dates:       string[]                  // 7 YYYY-MM-DD strings
  timezone:    string
  timeOfDay:   TimeOfDay
  onSlotClick: (slotStart: string) => void
}

function localHour(iso: string, timezone: string): number {
  return parseInt(
    new Date(iso).toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }),
    10
  )
}

function formatTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', {
    timeZone: timezone,
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  })
}

function formatDateHeader(dateStr: string): { weekday: string; day: string } {
  const d = new Date(dateStr + 'T12:00:00Z')
  return {
    weekday: d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', ''),
    day:     String(d.getUTCDate()),
  }
}

interface DayColProps {
  date:         string
  colSlots:     string[]
  colIdx:       number
  expandedCols: Set<number>
  timezone:     string
  onSlotClick:  (iso: string) => void
  onExpand:     (idx: number) => void
}

function DayCol({ date, colSlots, colIdx, expandedCols, timezone, onSlotClick, onExpand }: DayColProps) {
  const { weekday, day } = formatDateHeader(date)
  const isExpanded  = expandedCols.has(colIdx)
  const visible     = isExpanded ? colSlots : colSlots.slice(0, INITIAL_VISIBLE)
  const hiddenCount = colSlots.length - INITIAL_VISIBLE

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="text-center mb-0.5">
        <p className="text-[10px] font-medium text-slate-400 capitalize">{weekday}</p>
        <p className="text-sm font-bold text-slate-700">{day}</p>
      </div>

      {colSlots.length === 0 ? (
        <p className="text-[11px] text-slate-300 text-center pt-1">—</p>
      ) : (
        <>
          {visible.map((iso) => (
            <button
              key={iso}
              onClick={() => onSlotClick(iso)}
              className={cn(
                'w-full rounded-lg border border-primary/30 bg-primary/5',
                'py-1.5 text-[12px] font-semibold text-primary',
                'hover:bg-primary hover:text-white hover:border-primary',
                'transition-all duration-150'
              )}
            >
              {formatTime(iso, timezone)}
            </button>
          ))}

          {!isExpanded && hiddenCount > 0 && (
            <button
              onClick={() => onExpand(colIdx)}
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 text-[11px] text-slate-500 hover:border-slate-300 hover:text-slate-700 transition-all"
            >
              +{hiddenCount} más
            </button>
          )}
        </>
      )}
    </div>
  )
}

export function WeeklyGrid({ slots, dates, timezone, timeOfDay, onSlotClick }: Props) {
  const [expandedCols, setExpandedCols] = useState<Set<number>>(new Set())
  const [mobilePage,   setMobilePage]   = useState(0)

  // Reset mobile page whenever the week data changes
  useEffect(() => { setMobilePage(0) }, [dates])

  // Recomputed every time slots/dates change so the cutoff reflects the current moment
  const cutoff = useMemo(
    () => new Date(Date.now() + 15 * 60 * 1000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slots, dates]
  )

  const filteredSlots = useMemo(() => {
    return dates.map((date) => {
      const daySlots    = slots[date] ?? []
      const futureSlots = daySlots.filter((iso) => new Date(iso) > cutoff)
      if (timeOfDay === 'all') return futureSlots
      return futureSlots.filter((iso) => {
        const hour = localHour(iso, timezone)
        return timeOfDay === 'morning' ? hour < 14 : hour >= 14
      })
    })
  }, [slots, dates, timezone, timeOfDay, cutoff])

  const hasAnySlot = filteredSlots.some((s) => s.length > 0)

  if (dates.length === 0) return null

  if (!hasAnySlot) {
    return (
      <p className="text-xs text-slate-400 py-3 text-center">
        Sin disponibilidad en los próximos 7 días
        {timeOfDay !== 'all' && ' con este filtro de horario'}
      </p>
    )
  }

  function handleExpand(colIdx: number) {
    setExpandedCols((prev) => new Set([...prev, colIdx]))
  }

  const totalMobilePages = Math.ceil(dates.length / MOBILE_PAGE_SIZE)
  const mobileStart      = mobilePage * MOBILE_PAGE_SIZE
  const mobileDates      = dates.slice(mobileStart, mobileStart + MOBILE_PAGE_SIZE)

  return (
    <>
      {/* ── Mobile: 3-day paginated view (hidden on lg+) ─────────────────── */}
      <div className="lg:hidden">
        {totalMobilePages > 1 && (
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setMobilePage((p) => Math.max(0, p - 1))}
              disabled={mobilePage === 0}
              aria-label="Días anteriores"
              className="flex items-center justify-center h-7 w-7 rounded-md border border-slate-200 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:border-slate-300 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-medium text-slate-400 tabular-nums">
              {mobilePage + 1} / {totalMobilePages}
            </span>
            <button
              onClick={() => setMobilePage((p) => Math.min(totalMobilePages - 1, p + 1))}
              disabled={mobilePage >= totalMobilePages - 1}
              aria-label="Días siguientes"
              className="flex items-center justify-center h-7 w-7 rounded-md border border-slate-200 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:border-slate-300 transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${mobileDates.length}, 1fr)` }}>
          {mobileDates.map((date, localIdx) => {
            const globalColIdx = mobileStart + localIdx
            return (
              <DayCol
                key={date}
                date={date}
                colSlots={filteredSlots[globalColIdx]}
                colIdx={globalColIdx}
                expandedCols={expandedCols}
                timezone={timezone}
                onSlotClick={onSlotClick}
                onExpand={handleExpand}
              />
            )
          })}
        </div>
      </div>

      {/* ── Desktop: full 7-day horizontal scroll (hidden below lg) ─────── */}
      <div className="hidden lg:block overflow-x-auto -mx-1">
        <div className="flex gap-2 min-w-max px-1 pb-1">
          {dates.map((date, colIdx) => (
            <div key={date} className="w-[72px] shrink-0">
              <DayCol
                date={date}
                colSlots={filteredSlots[colIdx]}
                colIdx={colIdx}
                expandedCols={expandedCols}
                timezone={timezone}
                onSlotClick={onSlotClick}
                onExpand={handleExpand}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
