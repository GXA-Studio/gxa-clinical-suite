// Static color dictionary — NEVER interpolate class names dynamically (Tailwind purge).
// All classes must appear verbatim here so the compiler keeps them in the bundle.

export type AppointmentColor = 'blue' | 'emerald' | 'purple' | 'amber' | 'rose'

export const APPOINTMENT_COLOR_KEYS: AppointmentColor[] = ['blue', 'emerald', 'purple', 'amber', 'rose']

export const APPOINTMENT_COLORS: Record<
  AppointmentColor,
  { bg: string; border: string; text: string; textSub: string; hover: string }
> = {
  blue:    { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-800',    textSub: 'text-blue-500',    hover: 'hover:ring-blue-300'    },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', textSub: 'text-emerald-500', hover: 'hover:ring-emerald-300' },
  purple:  { bg: 'bg-purple-50',  border: 'border-purple-200',  text: 'text-purple-800',  textSub: 'text-purple-500',  hover: 'hover:ring-purple-300'  },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-800',   textSub: 'text-amber-500',   hover: 'hover:ring-amber-300'   },
  rose:    { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-800',    textSub: 'text-rose-500',    hover: 'hover:ring-rose-300'    },
}

export const COLOR_LABELS: Record<AppointmentColor, string> = {
  blue:    'Azul',
  emerald: 'Verde',
  purple:  'Morado',
  amber:   'Ámbar',
  rose:    'Rosa',
}

// Solid background for swatch circles in the picker UI
export const COLOR_SWATCHES: Record<AppointmentColor, string> = {
  blue:    'bg-blue-400',
  emerald: 'bg-emerald-400',
  purple:  'bg-purple-400',
  amber:   'bg-amber-400',
  rose:    'bg-rose-400',
}
