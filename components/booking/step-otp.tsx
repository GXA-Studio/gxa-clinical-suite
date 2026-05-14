'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Loader2, AlertCircle, RefreshCw, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const OTP_LENGTH = 6
const RESEND_COOLDOWN = 60 // seconds

interface Props {
  patientPhone:  string
  onVerify:      (code: string) => Promise<void>
  onResend:      () => Promise<void>
  isLoading:     boolean
  error:         string | null
}

export function StepOtp({ patientPhone, onVerify, onResend, isLoading, error }: Props) {
  const [digits,    setDigits]    = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [cooldown,  setCooldown]  = useState(RESEND_COOLDOWN)
  const [resending, setResending] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  function handleChange(index: number, value: string) {
    const char = value.replace(/\D/g, '').slice(-1)
    if (!char) return
    const next = [...digits]
    next[index] = char
    setDigits(next)
    if (index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus()
    if (next.every(Boolean)) {
      onVerify(next.join(''))
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const next = [...digits]
      if (next[index]) {
        next[index] = ''
        setDigits(next)
      } else if (index > 0) {
        next[index - 1] = ''
        setDigits(next)
        inputRefs.current[index - 1]?.focus()
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!text) return
    const next = Array(OTP_LENGTH).fill('')
    text.split('').forEach((c, i) => { next[i] = c })
    setDigits(next)
    const lastFilledIdx = Math.min(text.length, OTP_LENGTH - 1)
    inputRefs.current[lastFilledIdx]?.focus()
    if (text.length === OTP_LENGTH) {
      onVerify(text)
    }
  }

  async function handleResend() {
    setResending(true)
    setDigits(Array(OTP_LENGTH).fill(''))
    inputRefs.current[0]?.focus()
    await onResend()
    setCooldown(RESEND_COOLDOWN)
    setResending(false)
  }

  const maskedPhone = patientPhone.replace(/(\+\d{2,3})\d+(\d{4})$/, '$1****$2')

  return (
    <motion.div
      key="step-otp"
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -32 }}
      transition={{ duration: 0.22, ease: 'easeInOut' }}
      className="space-y-6"
    >
      <div className="text-center space-y-2">
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
        </div>
        <h2 className="text-xl font-bold text-slate-900">Verifica tu número</h2>
        <p className="text-sm text-slate-500">
          Enviamos un código de 6 dígitos a <span className="font-medium text-slate-700">{maskedPhone}</span>.
          Expira en 5 minutos.
        </p>
      </div>

      {/* OTP inputs */}
      <div className="flex justify-center gap-2.5" onPaste={handlePaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={d}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            disabled={isLoading}
            className={cn(
              'h-14 w-12 rounded-xl border-2 text-center text-xl font-bold transition-all outline-none',
              'focus:border-primary focus:ring-2 focus:ring-primary/20',
              d ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 bg-white text-slate-900',
              isLoading && 'opacity-50 cursor-not-allowed'
            )}
          />
        ))}
      </div>

      {isLoading && (
        <div className="flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5"
        >
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </motion.div>
      )}

      {/* Resend */}
      <div className="text-center">
        {cooldown > 0 ? (
          <p className="text-sm text-slate-400">
            ¿No recibiste el SMS? Reenviar en <span className="font-medium text-slate-600 tabular-nums">{cooldown}s</span>
          </p>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResend}
            disabled={resending || isLoading}
            className="text-sm text-primary hover:text-primary gap-1.5"
          >
            {resending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Reenviar código
          </Button>
        )}
      </div>
    </motion.div>
  )
}
