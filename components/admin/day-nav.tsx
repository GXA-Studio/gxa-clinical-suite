'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { Button }         from '@/components/ui/button'
import { Calendar }       from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function DayNav({ date }: { date: string }) {
  const router = useRouter()
  const [calOpen, setCalOpen] = useState(false)

  // Use parseISO so the local-midnight convention from date-fns is respected
  const parsed   = parseISO(date)
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const isToday  = date === todayStr

  const prevDate = format(subDays(parsed, 1), 'yyyy-MM-dd')
  const nextDate = format(addDays(parsed, 1), 'yyyy-MM-dd')
  const dayLabel = format(parsed, "EEEE, d 'de' MMMM", { locale: es })

  function navigate(to: string) {
    router.push(`/admin/agenda?date=${to}`)
  }

  function handleDaySelect(d: Date | undefined) {
    if (!d) return
    // Invariant: use format() from date-fns — never .toISOString()
    navigate(format(d, 'yyyy-MM-dd'))
    setCalOpen(false)
  }

  return (
    <div className="flex items-center gap-2">
      {/* Previous day */}
      <Button
        variant="outline"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => navigate(prevDate)}
        aria-label="Día anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      {/* Date label — opens Calendar Popover on click */}
      <Popover open={calOpen} onOpenChange={setCalOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2 px-3 font-normal"
            aria-label="Seleccionar fecha"
          >
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium capitalize">{dayLabel}</span>
            {isToday && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                Hoy
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center" sideOffset={6}>
          <Calendar
            mode="single"
            selected={parsed}
            onSelect={handleDaySelect}
            locale={es}
            // Dropdown navigation: month + year selectors instead of arrow-only
            captionLayout="dropdown"
            startMonth={new Date(2024, 0)}
            endMonth={new Date(2030, 11)}
            defaultMonth={parsed}
          />
        </PopoverContent>
      </Popover>

      {/* Next day */}
      <Button
        variant="outline"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => navigate(nextDate)}
        aria-label="Día siguiente"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {/* Jump to today — only shown when on a different day */}
      {!isToday && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground"
          onClick={() => navigate(todayStr)}
        >
          Ir a hoy
        </Button>
      )}
    </div>
  )
}
