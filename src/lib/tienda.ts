import { supabase } from './supabase'
import { productoFotoUrl } from './inventario'

export interface ProductoTienda {
  id: string
  nombre: string
  categoria: string | null
  precio: number
  foto_path: string | null
  disponible: boolean
  /** Precio por kilo; la cantidad se pide en unidades aproximadas o en gramos. */
  por_peso: boolean
  gramos_unidad: number | null
}

export async function loadCatalogoTienda(params: {
  search?: string
  categoria?: string
}): Promise<ProductoTienda[]> {
  const { data, error } = await supabase.rpc('ingreso_tienda_catalogo', {
    p_search: params.search || null,
    p_categoria: params.categoria || null,
  })
  if (error) throw error
  return (data as ProductoTienda[]) ?? []
}

export async function loadCategoriasTienda(): Promise<string[]> {
  const { data, error } = await supabase.rpc('ingreso_tienda_categorias')
  if (error) throw error
  return ((data as { categoria: string }[]) ?? []).map((r) => r.categoria)
}

export type MetodoPago = 'efectivo' | 'tarjeta' | 'online'

export const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  online: 'Pago online',
}

export interface PedidoTiendaInput {
  metodo: MetodoPago
  nombre: string
  telefono: string
  torre: string
  depto: string
  items: { producto_id: string; cantidad?: number; gramos?: number; unidades?: number }[]
}

export async function crearPedidoTienda(
  input: PedidoTiendaInput,
): Promise<{ pedido_id: string; total: number }> {
  const { data, error } = await supabase.rpc('ingreso_crear_pedido_tienda', {
    p_nombre: input.nombre,
    p_telefono: input.telefono,
    p_torre: input.torre,
    p_depto: input.depto,
    p_items: input.items,
    p_metodo: input.metodo,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { pedido_id: row.pedido_id, total: Number(row.total) }
}

export { productoFotoUrl }

export interface PedidoTiendaItem {
  id: string
  nombre_producto: string
  precio_unitario: number
  /** Unidades, o gramos si es_peso. */
  cantidad: number
  subtotal: number
  es_peso: boolean
  /** Unidades pedidas por el cliente (peso aproximado hasta que se pese). */
  unidades: number | null
  aprox: boolean
}

export interface PedidoTienda {
  id: string
  nombre_cliente: string
  telefono_cliente: string
  torre: string
  depto: string
  total: number
  estado: 'pendiente' | 'entregado' | 'cancelado'
  metodo_pago: MetodoPago | null
  pago_estado: 'pendiente' | 'comprobante_subido' | 'pagado'
  created_at: string
}

export async function loadPedidosTiendaPendientes(): Promise<PedidoTienda[]> {
  const { data, error } = await supabase
    .from('ingreso_pedidos_tienda')
    .select('*')
    .neq('estado', 'cancelado')
    // Se muestran los pedidos por entregar y los ya entregados que aun no estan pagados.
    .or('estado.eq.pendiente,pago_estado.neq.pagado')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as PedidoTienda[]) ?? []
}

export async function loadPedidoTiendaItems(pedidoId: string): Promise<PedidoTiendaItem[]> {
  const { data, error } = await supabase
    .from('ingreso_pedidos_tienda_items')
    .select('*')
    .eq('pedido_id', pedidoId)
  if (error) throw error
  return (data as PedidoTiendaItem[]) ?? []
}

export async function marcarPedidoTiendaEntregado(id: string) {
  const { error } = await supabase
    .from('ingreso_pedidos_tienda')
    .update({ estado: 'entregado' })
    .eq('id', id)
  if (error) throw error
}

/** Numero listo para el enlace de WhatsApp (wa.me), asume Chile si no trae codigo de pais. */
export function telefonoParaWhatsapp(telefono: string): string {
  const digits = telefono.replace(/\D/g, '')
  if (digits.startsWith('56')) return digits
  const local = digits.replace(/^0+/, '')
  return `56${local}`
}

export function whatsappEstoyAbajoUrl(telefono: string): string {
  const numero = telefonoParaWhatsapp(telefono)
  const mensaje = encodeURIComponent('Hola veci, estoy abajo')
  return `https://wa.me/${numero}?text=${mensaje}`
}

/** El personal registra el peso real de una linea pedida por unidad; recalcula el total del pedido. */
export async function ajustarPesoItem(itemId: string, gramos: number): Promise<number> {
  const { data, error } = await supabase.rpc('ingreso_ajustar_peso_item', {
    p_item_id: itemId,
    p_gramos: gramos,
  })
  if (error) throw error
  return Number(data)
}

export async function marcarPedidoPagado(pedidoId: string) {
  const { error } = await supabase.rpc('ingreso_marcar_pedido_pagado', { p_pedido: pedidoId })
  if (error) throw error
}

/** Pedidos de la tienda de un dia (cualquier estado), para el historial del personal. */
export async function loadPedidosTiendaDelDia(date: string): Promise<PedidoTienda[]> {
  const start = new Date(`${date}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const { data, error } = await supabase
    .from('ingreso_pedidos_tienda')
    .select('*')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as PedidoTienda[]) ?? []
}

// ---- Historial del cliente (sin cuenta): los IDs de sus pedidos quedan en su telefono.
const MIS_PEDIDOS_KEY = 'tlt_pedidos'

export function guardarPedidoIdLocal(id: string) {
  try {
    const ids = leerPedidoIdsLocal()
    localStorage.setItem(MIS_PEDIDOS_KEY, JSON.stringify([id, ...ids.filter((x) => x !== id)].slice(0, 50)))
  } catch {
    // sin almacenamiento: el pedido igual se envio
  }
}

function leerPedidoIdsLocal(): string[] {
  try {
    const raw = localStorage.getItem(MIS_PEDIDOS_KEY)
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export interface MiPedido {
  id: string
  created_at: string
  total: number
  estado: 'pendiente' | 'entregado' | 'cancelado'
  metodo_pago: MetodoPago | null
  pago_estado: 'pendiente' | 'comprobante_subido' | 'pagado'
  items: {
    nombre_producto: string
    cantidad: number
    es_peso: boolean
    unidades: number | null
    aprox: boolean
    subtotal: number
  }[]
}

export async function loadMisPedidos(): Promise<MiPedido[]> {
  const ids = leerPedidoIdsLocal()
  if (ids.length === 0) return []
  const { data, error } = await supabase.rpc('ingreso_pedidos_tienda_por_ids', { p_ids: ids })
  if (error) throw error
  return (data as MiPedido[]) ?? []
}
