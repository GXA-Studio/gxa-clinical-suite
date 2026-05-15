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

export interface SlotWithDoctors {
  start:   string         // ISO UTC timestamp
  doctors: DoctorOption[]
}

export interface ClinicBookingData {
  id: string
  name: string
  timezone: string
  services: (ServiceOption & { doctors: DoctorOption[] })[]
}

export interface BookingState {
  step:          number
  service:       ServiceOption | null
  slotStart:     string | null       // ISO UTC
  slotDoctors:   DoctorOption[]      // doctors available for chosen slot
  doctor:        DoctorOption | null // resolved doctor (auto or chosen)
  patientName:   string
  patientPhone:  string
  appointmentId: string | null
}
