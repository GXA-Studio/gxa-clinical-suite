'use client'
import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { TimeOfDay } from './types'

const INITIAL_VISIBLE = 3

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

export function WeeklyGrid({ slots, dates, timezone, timeOfDay, onSlotClick }: Props) {
  const [expandedCols, setExpandedCols] = useState<Set<number>>(new Set())

  // Recomputed every time slots/dates change so the cutoff reflects the current moment
  const cutoff = useMemo(
    () => new Date(Date.now() + 15 * 60 * 1000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slots, dates]
  )

  const filteredSlots = useMemo(() => {
    return dates.map((date) => {
      const daySlots = slots[date] ?? []
      // Strip slots within the 15-min grace window
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

  return (
    <div className="overflow-x-auto -mx-1">
      <div className="flex gap-2 min-w-max px-1 pb-1">
        {dates.map((date, colIdx) => {
          const { weekday, day } = formatDateHeader(date)
          const colSlots   = filteredSlots[colIdx]
          const isExpanded = expandedCols.has(colIdx)
          const visible    = isExpanded ? colSlots : colSlots.slice(0, INITIAL_VISIBLE)
          const hiddenCount = colSlots.length - INITIAL_VISIBLE

          return (
            <div key={date} className="flex flex-col items-center gap-1.5 w-[72px] shrink-0">
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
                      onClick={() =>
                        setExpandedCols((prev) => new Set([...prev, colIdx]))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white py-1.5 text-[11px] text-slate-500 hover:border-slate-300 hover:text-slate-700 transition-all"
                    >
                      +{hiddenCount} más
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
