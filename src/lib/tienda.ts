import { supabase } from './supabase'
import { productoFotoUrl } from './inventario'

export interface ProductoTienda {
  id: string
  nombre: string
  categoria: string | null
  precio: number
  foto_path: string | null
  disponible: boolean
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

export interface PedidoTiendaInput {
  nombre: string
  telefono: string
  torre: string
  depto: string
  items: { producto_id: string; cantidad: number }[]
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
  cantidad: number
  subtotal: number
}

export interface PedidoTienda {
  id: string
  nombre_cliente: string
  telefono_cliente: string
  torre: string
  depto: string
  total: number
  estado: 'pendiente' | 'entregado' | 'cancelado'
  created_at: string
}

export async function loadPedidosTiendaPendientes(): Promise<PedidoTienda[]> {
  const { data, error } = await supabase
    .from('ingreso_pedidos_tienda')
    .select('*')
    .eq('estado', 'pendiente')
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
