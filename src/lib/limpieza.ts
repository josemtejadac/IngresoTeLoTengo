import { supabase } from './supabase'
import { compressImageFile } from './compressImage'

const BUCKET = 'ingreso-limpieza'

export interface ReporteLimpieza {
  id: string
  worker_id: string
  nota: string
  foto_path: string
  tarea_id: string | null
  created_at: string
}

export async function loadReportesLimpieza(limit = 60): Promise<ReporteLimpieza[]> {
  const { data, error } = await supabase
    .from('ingreso_reportes_limpieza')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data as ReporteLimpieza[]) ?? []
}

/** Comprime la foto, la sube al bucket privado y crea el reporte con su nota. */
export async function crearReporteLimpieza(
  workerId: string,
  file: File,
  nota: string,
  tareaId: string | null = null,
) {
  const compressed = await compressImageFile(file)
  const path = `${workerId}/${Date.now()}.jpg`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, compressed, { contentType: 'image/jpeg' })
  if (uploadError) throw uploadError
  const { error } = await supabase
    .from('ingreso_reportes_limpieza')
    .insert({ worker_id: workerId, nota: nota.trim(), foto_path: path, tarea_id: tareaId })
  if (error) {
    // No dejar la foto huerfana si el registro no se pudo crear.
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
}

/** URLs firmadas (el bucket es privado) para mostrar varias fotos de una vez. */
export async function fotosLimpiezaUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
  if (error) throw error
  const map: Record<string, string> = {}
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) map[row.path] = row.signedUrl
  }
  return map
}

export async function eliminarReporteLimpieza(r: ReporteLimpieza) {
  const { error } = await supabase.from('ingreso_reportes_limpieza').delete().eq('id', r.id)
  if (error) throw error
  await supabase.storage.from(BUCKET).remove([r.foto_path])
}

export interface TareaLimpieza {
  id: string
  titulo: string
  creada_por: string
  created_at: string
  completada_por: string | null
  completada_at: string | null
}

export async function loadTareasLimpieza(): Promise<TareaLimpieza[]> {
  const { data, error } = await supabase
    .from('ingreso_tareas_limpieza')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data as TareaLimpieza[]) ?? []
}

export async function crearTareaLimpieza(adminId: string, titulo: string) {
  const { error } = await supabase
    .from('ingreso_tareas_limpieza')
    .insert({ creada_por: adminId, titulo: titulo.trim() })
  if (error) throw error
}

export async function eliminarTareaLimpieza(id: string) {
  const { error } = await supabase.from('ingreso_tareas_limpieza').delete().eq('id', id)
  if (error) throw error
}
