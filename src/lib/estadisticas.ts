import { supabase } from './supabase'

export interface ProductoTop {
  producto_id: string
  nombre: string
  unidades: number
  gramos: number
  ingresos: number
}

export interface ProductoSinVenta {
  producto_id: string
  nombre: string
  stock: number
  precio: number
}

export interface EstadisticasAdmin {
  total_ventas: number
  periodo_dias: number
  ingresos_periodo: number
  top_productos: ProductoTop[]
  sin_venta: ProductoSinVenta[]
}

/** Cuantas ventas (pedidos de tienda o manuales, entregados y pagados) hacen falta para desbloquear las estadisticas. */
export const VENTAS_PARA_ESTADISTICAS = 100

export interface HistorialIA {
  role: 'user' | 'model'
  text: string
}

/** Pide un analisis o responde una pregunta sobre las ventas, usando IA (misma clave gratuita del asistente de la tienda). */
export async function preguntarEstadisticasIA(
  estadisticas: EstadisticasAdmin,
  question: string,
  history: HistorialIA[],
): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Debes iniciar sesión de nuevo.')
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingreso-chat-estadisticas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question, history, estadisticas }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? 'No se pudo consultar a la IA')
  return String(body.answer ?? '')
}

/** Sin `dias`, trae estadisticas desde el primer pedido entregado y pagado que haya (sin tope de 90 dias). */
export async function loadEstadisticasAdmin(dias?: number): Promise<EstadisticasAdmin> {
  const { data, error } = await supabase.rpc('ingreso_estadisticas_admin', { p_dias: dias ?? null })
  if (error) throw error
  const d = data as EstadisticasAdmin
  return {
    total_ventas: Number(d.total_ventas) || 0,
    periodo_dias: Number(d.periodo_dias) || 0,
    ingresos_periodo: Number(d.ingresos_periodo) || 0,
    top_productos: (d.top_productos ?? []).map((p) => ({
      ...p,
      unidades: Number(p.unidades),
      gramos: Number(p.gramos),
      ingresos: Number(p.ingresos),
    })),
    sin_venta: (d.sin_venta ?? []).map((p) => ({ ...p, stock: Number(p.stock), precio: Number(p.precio) })),
  }
}
