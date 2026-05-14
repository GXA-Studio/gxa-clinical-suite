'use client'
import { useState, useTransition } from 'react'
import type { Service } from '@/lib/supabase/types'
import { createService, updateService, toggleService } from '@/app/(admin)/admin/services/actions'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import { Label }  from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch }   from '@/components/ui/switch'
import { Badge }    from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import { Plus, Pencil, Clock, DollarSign, Loader2 } from 'lucide-react'

type FormMode = 'create' | 'edit'

export function ServicesClient({ services: initial }: { services: Service[] }) {
  const [services,  setServices]  = useState(initial)
  const [open,      setOpen]      = useState(false)
  const [mode,      setMode]      = useState<FormMode>('create')
  const [selected,  setSelected]  = useState<Service | null>(null)
  const [pending,   startTransition] = useTransition()

  function openCreate() {
    setMode('create')
    setSelected(null)
    setOpen(true)
  }

  function openEdit(svc: Service) {
    setMode('edit')
    setSelected(svc)
    setOpen(true)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)

    startTransition(async () => {
      const result = mode === 'create'
        ? await createService(fd)
        : await updateService(selected!.id, fd)

      if (result.error) {
        toast({ variant: 'destructive', title: 'Error', description: typeof result.error === 'string' ? result.error : 'Verifica los campos.' })
        return
      }

      toast({ variant: 'success', title: mode === 'create' ? 'Servicio creado' : 'Servicio actualizado' })
      setOpen(false)
      // Optimistic UI: reload page data via Next.js revalidation
    })
  }

  async function handleToggle(svc: Service, checked: boolean) {
    setServices((prev) => prev.map((s) => s.id === svc.id ? { ...s, is_active: checked } : s))
    await toggleService(svc.id, checked)
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Nuevo servicio
        </Button>
      </div>

      <Card className="border-slate-200/70">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-slate-100">
                <TableHead>Nombre</TableHead>
                <TableHead>Duración</TableHead>
                <TableHead>Precio</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No hay servicios. Crea el primero.
                  </TableCell>
                </TableRow>
              ) : (
                services.map((svc) => (
                  <TableRow key={svc.id} className="border-slate-100">
                    <TableCell>
                      <p className="font-medium">{svc.name}</p>
                      {svc.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{svc.description}</p>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {svc.duration_minutes} min
                      </div>
                    </TableCell>
                    <TableCell>
                      {svc.price ? (
                        <div className="flex items-center gap-1 text-sm">
                          <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                          {Number(svc.price).toFixed(2)}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={svc.is_active}
                        onCheckedChange={(checked) => handleToggle(svc, checked)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(svc)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'Nuevo servicio' : 'Editar servicio'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input id="name" name="name" required defaultValue={selected?.name ?? ''} placeholder="Consulta general" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="duration_minutes">Duración (min) *</Label>
                <Input id="duration_minutes" name="duration_minutes" type="number" min={5} max={480} required
                  defaultValue={selected?.duration_minutes ?? 30} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price">Precio (opcional)</Label>
                <Input id="price" name="price" type="number" min={0} step="0.01"
                  defaultValue={selected?.price ?? ''} placeholder="0.00" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea id="description" name="description" rows={3}
                defaultValue={selected?.description ?? ''} placeholder="Descripción breve del servicio…" />
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
