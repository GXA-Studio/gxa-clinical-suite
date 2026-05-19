'use client'
import { useRouter } from 'next/navigation'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DayNav({ date }: { date: string }) {
  const router = useRouter()

  const parsed = parseISO(date)
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  const prevDate = format(subDays(parsed, 1), 'yyyy-MM-dd')
  const nextDate = format(addDays(parsed, 1), 'yyyy-MM-dd')
  const isToday  = date === todayStr

  const dayLabel = format(parsed, "EEEE, d 'de' MMMM", { locale: es })

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => router.push(`/admin/agenda?date=${prevDate}`)}
        aria-label="Día anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <div className="flex min-w-[200px] items-center justify-center gap-2">
        <span className="text-sm font-medium capitalize text-slate-700">{dayLabel}</span>
        {isToday && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
            Hoy
          </span>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => router.push(`/admin/agenda?date=${nextDate}`)}
        aria-label="Día siguiente"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {!isToday && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground"
          onClick={() => router.push(`/admin/agenda?date=${todayStr}`)}
        >
          Ir a hoy
        </Button>
      )}
    </div>
  )
}
