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
  /** Se vende por peso: precio = por kilo, stock y cantidades en gramos. */
  por_peso: boolean
  /** Gramos aproximados de una unidad (ej. un tomate); null = solo se vende por gramos. */
  gramos_unidad: number | null
}

/** Variantes de un codigo de barras: tal cual, sin ceros a la izquierda y con un cero delante. */
export function variantesCodigo(codigo: string): string[] {
  const c = codigo.trim()
  const sinCeros = c.replace(/^0+/, '')
  return [...new Set([c, sinCeros, `0${sinCeros}`].filter((v) => v !== ''))]
}

export async function loadProductos(params: {
  categoria?: string
  search?: string
  limit?: number
  /** Solo para el admin: incluir el catalogo maestro oculto (productos no activados). */
  soloInactivos?: boolean
  /** Solo para el admin: mostrar activos y ocultos juntos (ej. al buscar por codigo). */
  incluirInactivos?: boolean
  /** 'reciente' = lo ultimo modificado primero (util al ir escaneando el inventario). */
  orden?: 'nombre' | 'reciente'
}): Promise<Producto[]> {
  let query = supabase.from('ingreso_productos').select('*')
  if (!params.incluirInactivos) query = query.eq('active', !params.soloInactivos)
  query = (
    params.orden === 'reciente'
      ? query.order('updated_at', { ascending: false })
      : query.order('nombre')
  ).limit(params.limit ?? 100)

  if (params.categoria) query = query.eq('categoria', params.categoria)
  if (params.search) {
    const term = params.search.trim()
    const codigos = variantesCodigo(term).filter((v) => /^\d+$/.test(v))
    const porCodigo = codigos.length > 0 ? `,codigo_barras.in.(${codigos.join(',')})` : ''
    query = query.or(`nombre.ilike.%${term}%${porCodigo}`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data as Producto[]) ?? []
}

export async function loadProductoPorBarra(codigoBarras: string): Promise<Producto | null> {
  const { data, error } = await supabase
    .from('ingreso_productos')
    .select('*')
    .in('codigo_barras', variantesCodigo(codigoBarras))
    .eq('active', true)
    .limit(1)
  if (error) throw error
  return ((data as Producto[] | null)?.[0]) ?? null
}

export type ResultadoEscaneoAdmin =
  | { tipo: 'activado'; producto: Producto }
  | { tipo: 'ya_activo'; producto: Producto }
  | { tipo: 'no_encontrado' }

/**
 * Escaneo del admin para armar el inventario real: busca el codigo de barras
 * en el catalogo maestro (activo o no); si estaba oculto lo activa, y
 * opcionalmente suma 1 al stock (conteo fisico).
 */
export async function activarProductoPorBarra(
  codigoBarras: string,
  sumarStock: boolean,
): Promise<ResultadoEscaneoAdmin> {
  // limit(1) en vez de maybeSingle: si un codigo estuviera repetido no debe fallar la busqueda.
  const { data: rows, error } = await supabase
    .from('ingreso_productos')
    .select('*')
    .in('codigo_barras', variantesCodigo(codigoBarras))
    .order('active', { ascending: false })
    .limit(1)
  if (error) throw error
  const data = rows?.[0]
  if (!data) return { tipo: 'no_encontrado' }

  const producto = data as Producto
  const yaActivo = producto.active
  const nuevoStock = sumarStock ? producto.stock + 1 : producto.stock

  if (yaActivo && !sumarStock) return { tipo: 'ya_activo', producto }

  const { data: updated, error: updateError } = await supabase
    .from('ingreso_productos')
    .update({ active: true, stock: nuevoStock, updated_at: new Date().toISOString() })
    .eq('id', producto.id)
    .select('*')
    .single()
  if (updateError) throw updateError

  return { tipo: yaActivo ? 'ya_activo' : 'activado', producto: updated as Producto }
}

/** Producto que no existia en el catalogo maestro (ya activo desde el inicio). */
export async function crearProductoNuevo(params: {
  codigo_barras: string
  nombre: string
  categoria?: string
  stock?: number
}): Promise<Producto> {
  const { data, error } = await supabase
    .from('ingreso_productos')
    .insert({
      codigo_barras: params.codigo_barras.trim(),
      nombre: params.nombre.trim(),
      categoria: params.categoria?.trim() || null,
      stock: params.stock ?? 0,
      active: true,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Producto
}

export async function desactivarProducto(id: string) {
  const { error } = await supabase
    .from('ingreso_productos')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function loadCategorias(incluirInactivos = false): Promise<string[]> {
  let query = supabase
    .from('ingreso_productos')
    .select('categoria')
    .not('categoria', 'is', null)
    .limit(3000)
  if (!incluirInactivos) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw error
  const set = new Set((data as { categoria: string }[]).map((r) => r.categoria).filter(Boolean))
  return [...set].sort()
}

export async function updateProducto(
  id: string,
  fields: Partial<Pick<Producto, 'nombre' | 'precio' | 'foto_path' | 'stock' | 'categoria' | 'active' | 'por_peso' | 'gramos_unidad' | 'codigo_barras'>>,
) {
  const { error } = await supabase
    .from('ingreso_productos')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function uploadProductoFoto(productoId: string, file: File): Promise<string> {
  const compressed = await compressImageFile(file)
  return uploadProductoFotoBlob(productoId, compressed)
}

/** Sube una imagen ya lista (JPEG) como foto del producto y borra la anterior. */
export async function uploadProductoFotoBlob(productoId: string, blob: Blob): Promise<string> {
  const path = `${productoId}/${Date.now()}.jpg`
  const { error: uploadError } = await supabase.storage
    .from('ingreso-productos-fotos')
    .upload(path, blob, { contentType: 'image/jpeg' })
  if (uploadError) throw uploadError
  // Foto anterior (si habia): se borra para no acumular archivos sin uso.
  const { data: previo } = await supabase
    .from('ingreso_productos')
    .select('foto_path')
    .eq('id', productoId)
    .single()
  await updateProducto(productoId, { foto_path: path })
  const anterior = (previo as { foto_path: string | null } | null)?.foto_path
  if (anterior && anterior !== path) {
    await supabase.storage.from('ingreso-productos-fotos').remove([anterior])
  }
  return path
}

export function productoFotoUrl(fotoPath: string): string {
  const { data } = supabase.storage.from('ingreso-productos-fotos').getPublicUrl(fotoPath)
  return data.publicUrl
}

export interface PedidoItemInput {
  producto_id: string
  /** Unidades (productos normales). */
  cantidad?: number
  /** Gramos (productos por peso). */
  gramos?: number
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
