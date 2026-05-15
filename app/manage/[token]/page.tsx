import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ManagePortal } from './manage-portal'
import type { ServiceOption } from '@/components/booking/types'

export const metadata: Metadata = {
  title: 'Gestionar tu cita',
  robots: 'noindex',
}

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase  = createServiceClient()

  const { data: appt } = await supabase
    .from('appointments')
    .select(`
      id, starts_at, ends_at, status, cancellation_token, patient_name,
      doctors  ( id, name, specialty ),
      services ( id, name, duration_minutes, price, description ),
      clinics  ( id, name, timezone )
    `)
    .eq('cancellation_token', token)
    .single()

  if (!appt) return notFound()

  const clinic  = appt.clinics  as { id: string; name: string; timezone: string } | null
  const doctor  = appt.doctors  as { id: string; name: string; specialty: string | null } | null
  const service = appt.services as ServiceOption | null

  const isPast   = new Date(appt.starts_at) < new Date()
  const isActive = appt.status === 'confirmed' && !isPast

  return (
    <main className="min-h-screen bg-slate-50 flex items-start justify-center p-4 pt-10 pb-16">
      <ManagePortal
        token={token}
        appointment={{
          startsAt:    appt.starts_at,
          status:      appt.status,
          patientName: appt.patient_name,
        }}
        clinic={clinic}
        doctor={doctor}
        service={service}
        isActive={isActive}
        isPast={isPast}
      />
    </main>
  )
}
