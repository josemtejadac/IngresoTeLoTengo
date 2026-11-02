import { supabase } from './supabase'

/** Pago de un mes o semana de sueldo: por transferencia (con captura) o en efectivo. */
export interface PagoSueldo {
  periodo: string
  metodo: 'transferencia' | 'efectivo'
  comprobante_path: string | null
  monto: number | null
  pagado_at: string
}

const BUCKET = 'ingreso-comprobantes'

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Clave del periodo: mes "2026-10" o semana "S2026-10-26" (lunes). */
export const periodoMes = (month: string): string => month
export const periodoSemana = (lunes: Date): string => `S${iso(lunes)}`

/** Pagos marcados de un trabajador por periodo. Si aun no existe la tabla, devuelve vacio (el historial sigue andando). */
export async function loadPagosSueldo(workerId: string): Promise<Record<string, PagoSueldo>> {
  const { data, error } = await supabase
    .from('ingreso_pagos_sueldo')
    .select('periodo, metodo, comprobante_path, monto, pagado_at')
    .eq('worker_id', workerId)
  if (error) return {}
  return Object.fromEntries(((data as PagoSueldo[]) ?? []).map((p) => [p.periodo, p]))
}

/**
 * Deja la captura MUY chica (suele quedar en unos 20-40 KB): solo hace falta que se lea el monto y la fecha.
 * Reduce el ancho y baja la calidad hasta que pese poco.
 */
export async function comprimirCaptura(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const intentos: [number, number][] = [
    [720, 0.5],
    [640, 0.4],
    [560, 0.32],
    [480, 0.25],
  ]
  let ultimo: Blob | null = null
  for (const [ancho, calidad] of intentos) {
    const escala = Math.min(1, ancho / bitmap.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * escala)
    canvas.height = Math.round(bitmap.height * escala)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No se pudo procesar la captura')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', calidad))
    if (!blob) throw new Error('No se pudo comprimir la captura')
    ultimo = blob
    if (blob.size <= 45 * 1024) break
  }
  bitmap.close?.()
  return ultimo as Blob
}

/** Marca el periodo como pagado. Transferencia: sube la captura (comprimida). Efectivo: sin captura. */
export async function marcarPagado(params: {
  workerId: string
  periodo: string
  metodo: 'transferencia' | 'efectivo'
  monto: number
  captura?: File
}): Promise<void> {
  let path: string | null = null
  if (params.metodo === 'transferencia') {
    if (!params.captura) throw new Error('Adjunta la captura de la transferencia.')
    const blob = await comprimirCaptura(params.captura)
    path = `sueldos/${params.workerId}/${params.periodo}-${Date.now()}.jpg`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
    if (upErr) throw upErr
  }
  const { data: previo } = await supabase
    .from('ingreso_pagos_sueldo')
    .select('comprobante_path')
    .eq('worker_id', params.workerId)
    .eq('periodo', params.periodo)
    .maybeSingle()
  const { error } = await supabase.from('ingreso_pagos_sueldo').upsert(
    {
      worker_id: params.workerId,
      periodo: params.periodo,
      metodo: params.metodo,
      comprobante_path: path,
      monto: params.monto,
      pagado_at: new Date().toISOString(),
    },
    { onConflict: 'worker_id,periodo' },
  )
  if (error) {
    if (path) await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  // La captura anterior (si se cambio el pago) se borra para no acumular archivos.
  const anterior = (previo as { comprobante_path: string | null } | null)?.comprobante_path
  if (anterior && anterior !== path) await supabase.storage.from(BUCKET).remove([anterior])
}

/** Quita la marca de pagado (y borra la captura). */
export async function quitarPago(workerId: string, periodo: string, comprobantePath: string | null): Promise<void> {
  const { error } = await supabase.from('ingreso_pagos_sueldo').delete().eq('worker_id', workerId).eq('periodo', periodo)
  if (error) throw error
  if (comprobantePath) await supabase.storage.from(BUCKET).remove([comprobantePath])
}

/** Enlace temporal para ver la captura. */
export async function urlCaptura(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error || !data) throw error ?? new Error('No se pudo abrir la captura')
  return data.signedUrl
}
