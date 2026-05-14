'use client'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react'

export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'flex items-start gap-3 rounded-xl border p-4 shadow-lg transition-all animate-in slide-in-from-bottom-4',
            t.variant === 'destructive' && 'border-destructive/50 bg-destructive text-destructive-foreground',
            t.variant === 'success'     && 'border-emerald-200 bg-emerald-50 text-emerald-900',
            (!t.variant || t.variant === 'default') && 'border bg-background text-foreground'
          )}
        >
          {t.variant === 'destructive' && <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />}
          {t.variant === 'success'     && <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0 text-emerald-600" />}
          {(!t.variant || t.variant === 'default') && <Info className="h-5 w-5 mt-0.5 shrink-0 text-primary" />}
          <div className="flex-1 min-w-0">
            {t.title       && <p className="text-sm font-semibold">{t.title}</p>}
            {t.description && <p className="text-sm opacity-90 mt-0.5">{t.description}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-70 hover:opacity-100 transition-opacity">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
