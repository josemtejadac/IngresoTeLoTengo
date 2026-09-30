import { supabase } from './supabase'
import { compressImageFile } from './compressImage'

const BUCKET = 'ingreso-limpieza'

export interface ReporteLimpieza {
  id: string
  worker_id: string
  nota: string
  foto_path: string
  /** Hasta 3 fotos del reporte (foto_path es solo la primera, por compatibilidad). */
  foto_paths: string[]
  tarea_id: string | null
  created_at: string
}

export const MAX_FOTOS_LIMPIEZA = 3

export async function loadReportesLimpieza(limit = 60): Promise<ReporteLimpieza[]> {
  const { data, error } = await supabase
    .from('ingreso_reportes_limpieza')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data as ReporteLimpieza[]) ?? []
}

/**
 * Comprime hasta 3 fotos (las que vienen de la cámara ya llegan comprimidas), las sube al bucket
 * privado y crea el reporte con su nota.
 */
export async function crearReporteLimpieza(
  workerId: string,
  fotos: (File | Blob)[],
  nota: string,
  tareaId: string | null = null,
) {
  if (fotos.length === 0) throw new Error('Agrega al menos una foto.')
  if (fotos.length > MAX_FOTOS_LIMPIEZA) throw new Error(`Máximo ${MAX_FOTOS_LIMPIEZA} fotos.`)

  const paths: string[] = []
  try {
    for (const foto of fotos) {
      const blob = foto instanceof File ? await compressImageFile(foto) : foto
      const path = `${workerId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg' })
      if (uploadError) throw uploadError
      paths.push(path)
    }
    const { error } = await supabase
      .from('ingreso_reportes_limpieza')
      .insert({ worker_id: workerId, nota: nota.trim(), foto_path: paths[0], foto_paths: paths, tarea_id: tareaId })
    if (error) throw error
  } catch (err) {
    // No dejar fotos huerfanas si algo del proceso falla.
    if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths)
    throw err
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
  const paths = r.foto_paths?.length > 0 ? r.foto_paths : [r.foto_path]
  await supabase.storage.from(BUCKET).remove(paths)
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
