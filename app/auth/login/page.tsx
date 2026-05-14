'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { Label }   from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Stethoscope, Loader2, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)
  const router  = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError(authError.message === 'Invalid login credentials'
        ? 'Correo o contraseña incorrectos.'
        : authError.message)
      setLoading(false)
      return
    }

    router.push('/admin')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50/30 p-4">
      <div className="w-full max-w-md">
        {/* Logo mark */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary p-2.5">
              <Stethoscope className="h-6 w-6 text-white" />
            </div>
            <span className="text-xl font-semibold text-slate-800">MedBooking</span>
          </div>
        </div>

        <Card className="shadow-lg border-slate-200/60">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl">Bienvenido</CardTitle>
            <CardDescription>Accede al panel de administración</CardDescription>
          </CardHeader>

          <CardContent className="pt-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@clinica.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Accediendo…</> : 'Acceder'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Sistema de reservas médicas · Uso exclusivo del personal
        </p>
      </div>
    </div>
  )
}
