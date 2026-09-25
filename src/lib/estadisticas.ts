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

export async function loadEstadisticasAdmin(dias = 90): Promise<EstadisticasAdmin> {
  const { data, error } = await supabase.rpc('ingreso_estadisticas_admin', { p_dias: dias })
  if (error) throw error
  const d = data as EstadisticasAdmin
  return {
    total_ventas: Number(d.total_ventas) || 0,
    periodo_dias: dias,
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
