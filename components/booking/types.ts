export interface ServiceOption {
  id: string
  name: string
  duration_minutes: number
  price: number | null
  description: string | null
}

export interface DoctorOption {
  id: string
  name: string
  specialty: string | null
}

export interface ClinicBookingData {
  id: string
  name: string
  timezone: string
  services: (ServiceOption & { doctors: DoctorOption[] })[]
}

export interface BookingState {
  step: number
  service:       ServiceOption | null
  doctor:        DoctorOption | null
  slotStart:     string | null   // ISO UTC
  patientName:   string
  patientPhone:  string
  appointmentId: string | null
}
