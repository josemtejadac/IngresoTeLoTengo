import { supabase } from './supabase'
import { compressImageFile } from './compressImage'

export interface Producto {
  id: string
  codigo_producto: string | null
  codigo_barras: string | null
  nombre: string
  categoria: string | null
  unidad_medida: string | null
  precio: number | null
  foto_path: string | null
  stock: number
  active: boolean
}

export async function loadProductos(params: {
  categoria?: string
  search?: string
  limit?: number
}): Promise<Producto[]> {
  let query = supabase
    .from('ingreso_productos')
    .select('*')
    .eq('active', true)
    .order('nombre')
    .limit(params.limit ?? 100)

  if (params.categoria) query = query.eq('categoria', params.categoria)
  if (params.search) {
    const term = params.search.trim()
    query = query.or(`nombre.ilike.%${term}%,codigo_barras.eq.${term}`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data as Producto[]) ?? []
}

export async function loadProductoPorBarra(codigoBarras: string): Promise<Producto | null> {
  const { data, error } = await supabase
    .from('ingreso_productos')
    .select('*')
    .eq('codigo_barras', codigoBarras.trim())
    .eq('active', true)
    .maybeSingle()
  if (error) throw error
  return (data as Producto | null) ?? null
}

export async function loadCategorias(): Promise<string[]> {
  const { data, error } = await supabase
    .from('ingreso_productos')
    .select('categoria')
    .eq('active', true)
    .not('categoria', 'is', null)
    .limit(3000)
  if (error) throw error
  const set = new Set((data as { categoria: string }[]).map((r) => r.categoria).filter(Boolean))
  return [...set].sort()
}

export async function updateProducto(
  id: string,
  fields: Partial<Pick<Producto, 'nombre' | 'precio' | 'foto_path' | 'stock' | 'categoria'>>,
) {
  const { error } = await supabase
    .from('ingreso_productos')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function uploadProductoFoto(productoId: string, file: File): Promise<string> {
  const compressed = await compressImageFile(file)
  const path = `${productoId}/${Date.now()}.jpg`
  const { error: uploadError } = await supabase.storage
    .from('ingreso-productos-fotos')
    .upload(path, compressed, { contentType: 'image/jpeg' })
  if (uploadError) throw uploadError
  await updateProducto(productoId, { foto_path: path })
  return path
}

export function productoFotoUrl(fotoPath: string): string {
  const { data } = supabase.storage.from('ingreso-productos-fotos').getPublicUrl(fotoPath)
  return data.publicUrl
}

export interface PedidoItemInput {
  producto_id: string
  cantidad: number
}

export async function crearPedido(items: PedidoItemInput[]): Promise<{
  pedido_id: string
  total: number
}> {
  const { data, error } = await supabase.rpc('ingreso_crear_pedido', { p_items: items })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { pedido_id: row.pedido_id, total: Number(row.total) }
}

export interface Pedido {
  id: string
  worker_id: string
  total: number
  created_at: string
}

export async function loadPedidosForDate(date: string): Promise<Pedido[]> {
  const start = `${date}T00:00:00`
  const end = `${date}T23:59:59`
  const { data, error } = await supabase
    .from('ingreso_pedidos')
    .select('*')
    .gte('created_at', start)
    .lte('created_at', end)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as Pedido[]) ?? []
}
