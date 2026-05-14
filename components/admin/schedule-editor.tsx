'use client'
import { useState, useTransition } from 'react'
import { createSchedule, deleteSchedule, toggleSchedule } from '@/app/(admin)/admin/schedules/actions'
import { Button }    from '@/components/ui/button'
import { Badge }     from '@/components/ui/badge'
import { Switch }    from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label }     from '@/components/ui/label'
import { Input }     from '@/components/ui/input'
import { toast }     from '@/hooks/use-toast'
import { Plus, Trash2, Loader2, Clock } from 'lucide-react'

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DAY_COLORS = [
  'bg-rose-50 border-rose-200 text-rose-700',
  'bg-blue-50 border-blue-200 text-blue-700',
  'bg-violet-50 border-violet-200 text-violet-700',
  'bg-emerald-50 border-emerald-200 text-emerald-700',
  'bg-amber-50 border-amber-200 text-amber-700',
  'bg-cyan-50 border-cyan-200 text-cyan-700',
  'bg-pink-50 border-pink-200 text-pink-700',
]

interface ScheduleRow {
  id: string
  doctor_id: string
  day_of_week: number
  start_time: string
  end_time: string
  is_active: boolean
}

interface DoctorWithSchedules {
  id: string
  name: string
  specialty: string | null
  is_active: boolean
  schedules: ScheduleRow[]
}

function formatTime(t: string) {
  return t.slice(0, 5)
}

export function ScheduleEditor({ doctors }: { doctors: DoctorWithSchedules[] }) {
  const [open,          setOpen]          = useState(false)
  const [activeDoctorId, setActiveDoctorId] = useState<string>(doctors[0]?.id ?? '')
  const [addDay,        setAddDay]        = useState<string>('1')
  const [pending,       start]            = useTransition()

  const activeDoctor = doctors.find((d) => d.id === activeDoctorId)

  const schedulesByDay = (activeDoctor?.schedules ?? []).reduce<Record<number, ScheduleRow[]>>((acc, s) => {
    if (!acc[s.day_of_week]) acc[s.day_of_week] = []
    acc[s.day_of_week].push(s)
    return acc
  }, {})

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('doctor_id', activeDoctorId)
    start(async () => {
      const result = await createSchedule(fd)
      if (result.error) {
        const msg = typeof result.error === 'string' ? result.error : 'Verifica los campos.'
        toast({ variant: 'destructive', title: 'Error', description: msg })
        return
      }
      toast({ variant: 'success', title: 'Turno agregado' })
      setOpen(false)
    })
  }

  async function handleDelete(id: string) {
    start(async () => {
      await deleteSchedule(id)
      toast({ variant: 'success', title: 'Turno eliminado' })
    })
  }

  async function handleToggle(id: string, checked: boolean) {
    await toggleSchedule(id, checked)
  }

  if (doctors.length === 0) {
    return (
      <Card className="border-slate-200/70">
        <CardContent className="h-40 flex items-center justify-center text-muted-foreground text-sm">
          No hay médicos activos. Activa o crea médicos primero.
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {/* Doctor tabs */}
      <div className="flex gap-2 flex-wrap">
        {doctors.map((d) => (
          <button
            key={d.id}
            onClick={() => setActiveDoctorId(d.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              d.id === activeDoctorId
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {d.name}
            {d.specialty && <span className="ml-1.5 opacity-60 text-xs">· {d.specialty}</span>}
          </button>
        ))}
      </div>

      <Card className="border-slate-200/70">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-base font-semibold">
            Horario semanal — {activeDoctor?.name}
          </CardTitle>
          <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Añadir turno
          </Button>
        </CardHeader>
        <CardContent>
          {/* Weekly grid */}
          <div className="grid grid-cols-7 gap-2">
            {DAYS.map((day, idx) => (
              <div key={idx} className="min-h-[100px]">
                <p className={`text-xs font-semibold text-center mb-2 rounded-md py-1 border ${DAY_COLORS[idx]}`}>
                  {day}
                </p>
                <div className="space-y-1.5">
                  {(schedulesByDay[idx] ?? [])
                    .sort((a, b) => a.start_time.localeCompare(b.start_time))
                    .map((s) => (
                      <div
                        key={s.id}
                        className={`group relative rounded-md border p-1.5 text-xs transition-opacity ${
                          s.is_active ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-1 text-slate-700 font-mono">
                          <Clock className="h-2.5 w-2.5 text-slate-400 shrink-0" />
                          <span>{formatTime(s.start_time)}</span>
                        </div>
                        <div className="text-slate-400 font-mono pl-3.5">{formatTime(s.end_time)}</div>
                        {/* Hover actions */}
                        <div className="absolute inset-0 bg-white/90 rounded-md hidden group-hover:flex items-center justify-center gap-1.5">
                          <Switch
                            checked={s.is_active}
                            onCheckedChange={(c) => handleToggle(s.id, c)}
                            className="scale-75"
                          />
                          <button
                            onClick={() => handleDelete(s.id)}
                            className="p-0.5 text-rose-500 hover:text-rose-700 transition-colors"
                            disabled={pending}
                          >
                            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                    ))}
                  {(schedulesByDay[idx] ?? []).length === 0 && (
                    <p className="text-[10px] text-slate-300 text-center pt-2">—</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Add shift dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Añadir turno — {activeDoctor?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <input type="hidden" name="doctor_id" value={activeDoctorId} />
            <div className="space-y-2">
              <Label>Día de la semana</Label>
              <Select name="day_of_week" value={addDay} onValueChange={setAddDay}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((d, i) => (
                    <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_time">Inicio</Label>
                <Input id="start_time" name="start_time" type="time" required defaultValue="08:00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">Fin</Label>
                <Input id="end_time" name="end_time" type="time" required defaultValue="14:00" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={pending}>
                {pending ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
