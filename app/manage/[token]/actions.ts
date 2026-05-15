'use server'
import { createServiceClient } from '@/lib/supabase/server'

export async function cancelByToken(token: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('cancellation_token', token)
    .eq('status', 'confirmed')
    .gt('starts_at', new Date().toISOString())
    .select('id')
    .single()

  if (error || !data) {
    return { success: false, error: 'No se pudo cancelar la cita. Es posible que ya esté cancelada o haya pasado.' }
  }

  return { success: true }
}

export async function rescheduleAppointment(
  token: string,
  newDoctorId: string,
  newStartsAt: string,
): Promise<{ success: boolean; newStartsAt?: string; error?: string }> {
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc('reschedule_appointment', {
    p_cancellation_token: token,
    p_new_doctor_id:      newDoctorId,
    p_new_starts_at:      newStartsAt,
  })

  if (error) {
    if (error.code === 'P0001') {
      return { success: false, error: 'Este hueco ya está ocupado. Por favor elige otro.' }
    }
    if (error.code === 'P0002') {
      return { success: false, error: 'No encontramos tu cita o ya fue cancelada anteriormente.' }
    }
    if (error.code === 'P0004') {
      return { success: false, error: 'La nueva hora seleccionada ya ha pasado.' }
    }
    console.error('[rescheduleAppointment] RPC error:', error)
    return { success: false, error: 'Error al reprogramar la cita. Por favor inténtalo de nuevo.' }
  }

  const appt = Array.isArray(data) ? data[0] : data as { starts_at: string }
  return { success: true, newStartsAt: appt?.starts_at }
}
