export type Role = 'admin' | 'worker'

export interface DaySchedule {
  start: string
  end: string
}

/** Claves: dia de la semana como string, "0" (domingo) a "6" (sabado). */
export type WeeklySchedule = Partial<Record<string, DaySchedule>>

export interface Profile {
  id: string
  full_name: string
  role: Role
  active: boolean
  created_at: string
  rut: string | null
  weekly_schedule: WeeklySchedule | null
  pay_amount: number | null
  pay_frequency: 'weekly' | 'monthly' | null
  tuesday_bonus: number
  weekly_bonus_eligible: boolean
  /** El admin decide quien puede cambiar precio, stock y fotos de los productos. */
  puede_editar_productos: boolean
  /** El admin decide quien puede subir facturas para sumar stock. */
  puede_cargar_facturas: boolean
}

export interface Attendance {
  id: string
  worker_id: string
  type: 'entrada' | 'salida' | 'ingreso_colacion' | 'salida_colacion'
  recorded_at: string
  photo_path: string | null
  created_at: string
}
