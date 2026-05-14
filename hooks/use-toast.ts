'use client'
import * as React from 'react'

const TOAST_LIMIT = 3
const TOAST_REMOVE_DELAY = 4000

type ToastVariant = 'default' | 'destructive' | 'success'

export interface Toast {
  id: string
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

type ToasterToast = Toast & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const listeners: Array<(state: ToasterToast[]) => void> = []
let memoryState: ToasterToast[] = []

function dispatch(toasts: ToasterToast[]) {
  memoryState = toasts
  listeners.forEach((l) => l(toasts))
}

function toast(props: Omit<Toast, 'id'>) {
  const id = String(Math.random())
  const update = (t: Partial<Toast>) =>
    dispatch(memoryState.map((item) => (item.id === id ? { ...item, ...t } : item)))
  const dismiss = () => dispatch(memoryState.filter((item) => item.id !== id))

  dispatch([
    {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) {
          setTimeout(dismiss, TOAST_REMOVE_DELAY)
        }
      },
    },
    ...memoryState,
  ].slice(0, TOAST_LIMIT))

  return { id, dismiss, update }
}

function useToast() {
  const [toasts, setToasts] = React.useState<ToasterToast[]>(memoryState)

  React.useEffect(() => {
    listeners.push(setToasts)
    return () => {
      const index = listeners.indexOf(setToasts)
      if (index > -1) listeners.splice(index, 1)
    }
  }, [])

  return { toasts, toast, dismiss: (id: string) => dispatch(memoryState.filter((t) => t.id !== id)) }
}

export { useToast, toast }
