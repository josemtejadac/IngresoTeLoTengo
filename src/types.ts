export type Role = 'admin' | 'worker'

export interface Profile {
  id: string
  full_name: string
  role: Role
  active: boolean
  created_at: string
}

export interface Attendance {
  id: string
  worker_id: string
  type: 'entrada' | 'salida' | 'ingreso_colacion' | 'salida_colacion'
  recorded_at: string
  photo_path: string | null
  created_at: string
}
