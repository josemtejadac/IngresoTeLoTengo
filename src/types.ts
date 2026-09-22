export type Role = 'admin' | 'worker'

export interface Profile {
  id: string
  full_name: string
  role: Role
  active: boolean
  created_at: string
  rut: string | null
  schedule_start: string | null
  schedule_end: string | null
  work_days: number[] | null
  pay_amount: number | null
  pay_frequency: 'weekly' | 'monthly' | null
  tuesday_bonus: number
}

export interface Attendance {
  id: string
  worker_id: string
  type: 'entrada' | 'salida' | 'ingreso_colacion' | 'salida_colacion'
  recorded_at: string
  photo_path: string | null
  created_at: string
}
