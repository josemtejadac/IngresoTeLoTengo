import { supabase } from './supabase'
import { productoFotoUrl } from './inventario'

export interface ProductoTienda {
  id: string
  nombre: string
  categoria: string | null
  /** Precio final (ya con descuento aplicado si tiene). */
  precio: number
  /** Precio normal sin descuento: solo viene si el producto tiene descuento activo. */
  precio_original: number | null
  /** Porcentaje de descuento activo (0-90), o null si no tiene. */
  descuento_pct: number | null
  /** Nota visible para el cliente en la tienda (ej. fecha de vencimiento). */
  nota: string | null
  /** Fijado: aparece primero en la tienda (antes que el resto, salvo que este sin stock). */
  destacado: boolean
  foto_path: string | null
  disponible: boolean
  /** Precio por kilo; la cantidad se pide en unidades aproximadas o en gramos. */
  por_peso: boolean
  gramos_unidad: number | null
  /** Unidades disponibles (null en productos por peso). */
  stock_max: number | null
  /** Precio por pack (ej. 3 x $1000): null si el producto no se vende en pack. */
  combo_cantidad: number | null
  combo_precio: number | null
  /** Si hay stock suficiente para armar al menos un pack. */
  combo_disponible: boolean
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

export type PagoEstado = 'pendiente' | 'comprobante_subido' | 'pagado' | 'esperando_pago'

export type FiltroPago = 'todos' | 'online' | 'contraentrega'

/** Pago online = Flow; contra entrega = efectivo, débito, crédito o transferencia al recibir. */
export function coincideFiltroPago(metodo: MetodoPago | null, filtro: FiltroPago): boolean {
  if (filtro === 'todos') return true
  if (filtro === 'online') return metodo === 'online'
  return metodo !== 'online'
}

// 'tarjeta' solo aparece en pedidos viejos, de antes de separar debito/credito; ya no se genera.
// 'transferencia' y 'qr' solo las marca el personal (el cliente no las elige en la tienda).
// 'mixto' = el cliente pago con mas de un metodo (ej. parte debito, parte efectivo); el reparto exacto
// queda en pago_mixto, y cada monto se suma a la columna de arqueo que corresponde.
export type MetodoPago = 'efectivo' | 'debito' | 'credito' | 'transferencia' | 'qr' | 'tarjeta' | 'online' | 'mixto'

export const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
  qr: 'QR',
  tarjeta: 'Tarjeta',
  online: 'Pago online',
  mixto: 'Pago mixto',
}

/** Metodos que de verdad se suman al arqueo (excluye 'online', que va directo a Flow, y 'mixto', que es el contenedor). */
export const METODOS_ARQUEO = ['efectivo', 'debito', 'credito', 'transferencia', 'qr'] as const
export type MetodoArqueo = (typeof METODOS_ARQUEO)[number]

export interface PedidoTiendaInput {
  metodo: MetodoPago
  nombre: string
  telefono: string
  torre: string
  depto: string
  items: { producto_id: string; cantidad?: number; gramos?: number; unidades?: number; es_combo?: boolean }[]
  /** Si paga en efectivo: con cuanto billete va a pagar, para que el trabajador lleve el vuelto listo. */
  pagoCon?: number
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
    p_pago_con: input.pagoCon || null,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { pedido_id: row.pedido_id, total: Number(row.total) }
}

export { productoFotoUrl }

export interface PedidoTiendaItem {
  id: string
  producto_id: string | null
  nombre_producto: string
  precio_unitario: number
  /** Unidades, o gramos si es_peso. */
  cantidad: number
  subtotal: number
  es_peso: boolean
  /** Unidades pedidas por el cliente (peso aproximado hasta que se pese). */
  unidades: number | null
  aprox: boolean
  /** Se compro por pack (ej. 3 x $1000): cantidad son las unidades reales que salieron del stock. */
  es_combo: boolean
}

export interface PedidoTienda {
  id: string
  nombre_cliente: string
  telefono_cliente: string
  torre: string
  depto: string
  total: number
  estado: 'pendiente' | 'entregado' | 'cancelado'
  progreso?: ProgresoPedido
  metodo_pago: MetodoPago | null
  pago_estado: PagoEstado
  created_at: string
  cancelado_por_cliente?: boolean
  cancelado_at?: string | null
  /** Si pago en efectivo: con cuanto billete va a pagar el cliente. */
  pago_con?: number | null
  /** Quien salio fisicamente a entregarlo (ej. el turno que entra), sin ser necesariamente quien lo cobra/confirma. */
  entrega_fisica_por?: string | null
  entrega_fisica_at?: string | null
  /** Solo si metodo_pago = 'mixto': cuanto se pago con cada metodo, ej. {"debito": 2200, "efectivo": 450}. */
  pago_mixto?: Partial<Record<MetodoArqueo, number>> | null
  /** Quien lo marco como entregado (para poder filtrar el historial por trabajador). */
  entregado_por?: string | null
}

export async function loadPedidosTiendaPendientes(): Promise<PedidoTienda[]> {
  const { data, error } = await supabase
    .from('ingreso_pedidos_tienda')
    .select('*')
    .neq('estado', 'cancelado')
    // Un pedido online aparece solo cuando Flow confirma el pago.
    .neq('pago_estado', 'esperando_pago')
    // Se muestran los pedidos por entregar y los ya entregados que aun no estan pagados.
    .or('estado.eq.pendiente,pago_estado.neq.pagado')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as PedidoTienda[]) ?? []
}

/** Fotos de varios productos a la vez (id -> ruta de la foto), para mostrarlas en el detalle de un pedido. */
export async function loadFotosProductos(ids: string[]): Promise<Record<string, string | null>> {
  if (ids.length === 0) return {}
  const { data, error } = await supabase.from('ingreso_productos').select('id, foto_path').in('id', ids)
  if (error) throw error
  return Object.fromEntries(((data as { id: string; foto_path: string | null }[]) ?? []).map((r) => [r.id, r.foto_path]))
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

/**
 * Marca (o desmarca) que alguien ya salio a entregar el pedido fisicamente, sin sumarlo a su arqueo.
 * Sirve para el cambio de turno: el que entra deja el check, y el dueño del turno confirma "Entregado" despues.
 */
export async function marcarEntregaFisica(id: string, entregar: boolean) {
  const { data: userData } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('ingreso_pedidos_tienda')
    .update(
      entregar
        ? { entrega_fisica_por: userData.user?.id ?? null, entrega_fisica_at: new Date().toISOString() }
        : { entrega_fisica_por: null, entrega_fisica_at: null },
    )
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

export function whatsappEnCaminoUrl(telefono: string): string {
  const numero = telefonoParaWhatsapp(telefono)
  const mensaje = encodeURIComponent('Hola veci, estoy en camino')
  return `https://wa.me/${numero}?text=${mensaje}`
}

/**
 * Avanza el progreso del pedido para que el cliente lo vea en su app (y le llegue la notificación si
 * la activó). Nunca retrocede: si ya estaba en "en_camino" y se llama con "preparando", no hace nada.
 */
export async function marcarProgresoPedido(pedidoId: string, progreso: 'preparando' | 'en_camino') {
  const { error } = await supabase.rpc('ingreso_pedido_marcar_progreso', {
    p_pedido: pedidoId,
    p_progreso: progreso,
  })
  if (error) throw error
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

/** El personal cambia entre efectivo/debito/credito en un pedido contra entrega (online no se puede cambiar). */
export async function cambiarMetodoPedido(pedidoId: string, metodo: 'efectivo' | 'debito' | 'credito' | 'transferencia' | 'qr') {
  const { error } = await supabase.rpc('ingreso_cambiar_metodo_pedido', { p_pedido: pedidoId, p_metodo: metodo })
  if (error) throw error
}

/**
 * Fija (o corrige) el pago de un pedido YA ENTREGADO como mixto: cada monto entra a la columna de
 * arqueo que corresponde, y si el pedido ya tenia un metodo (o mixto) sumado, primero se revierte
 * ese monto viejo antes de sumar el nuevo reparto. `montos` no necesita traer todos los metodos, solo
 * los que tengan algo (deben sumar exacto el total del pedido).
 */
export async function fijarPagoMixto(pedidoId: string, montos: Partial<Record<MetodoArqueo, number>>) {
  const { error } = await supabase.rpc('ingreso_fijar_pago_mixto', { p_pedido: pedidoId, p_montos: montos })
  if (error) throw error
}

/** Marca entregado (y pagado) un pedido pendiente, repartiendo el cobro entre varios metodos de una vez. */
export async function marcarEntregadoMixto(pedidoId: string, montos: Partial<Record<MetodoArqueo, number>>) {
  const { error } = await supabase.rpc('ingreso_marcar_entregado_mixto', { p_pedido: pedidoId, p_montos: montos })
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
    .neq('pago_estado', 'esperando_pago')
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

/** Progreso mas fino mientras el pedido esta pendiente (una vez entregado/cancelado, ya no importa). */
export type ProgresoPedido = 'recibido' | 'preparando' | 'en_camino'

export interface MiPedido {
  id: string
  created_at: string
  total: number
  cancelado_por_cliente?: boolean
  estado: 'pendiente' | 'entregado' | 'cancelado'
  progreso: ProgresoPedido
  metodo_pago: MetodoPago | null
  pago_estado: PagoEstado
  items: {
    producto_id: string | null
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

/** Crea el pago en Flow para un pedido online y devuelve la direccion a la que hay que llevar al cliente. */
export async function iniciarPagoFlow(pedidoId: string, email: string): Promise<string> {
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingreso-flow-crear-pago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pedido_id: pedidoId, email }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.url) throw new Error(body.error ?? 'No se pudo iniciar el pago online')
  return body.url as string
}

/** El cliente cancela su pedido online que aun no pago (se devuelve el stock). */
export async function cancelarPedidoCliente(pedidoId: string) {
  const { error } = await supabase.rpc('ingreso_cancelar_pedido_cliente', { p_pedido: pedidoId })
  if (error) throw error
}

/** El personal elimina un pedido por error del cliente (ej. lo hizo varias veces). Devuelve el stock reservado. */
export async function eliminarPedidoTienda(pedidoId: string) {
  const { error } = await supabase.rpc('ingreso_eliminar_pedido_tienda', { p_pedido: pedidoId })
  if (error) throw error
}

/** El personal agrega un producto extra a un pedido ya hecho (ej. el cliente pidio algo mas por telefono). */
export async function agregarItemPedido(pedidoId: string, productoId: string, cantidad: number, esCombo = false) {
  const { error } = await supabase.rpc('ingreso_agregar_item_pedido', {
    p_pedido: pedidoId,
    p_producto: productoId,
    p_cantidad: cantidad,
    p_es_combo: esCombo,
  })
  if (error) throw error
}

/** El personal quita un producto de un pedido ya hecho (ej. se olvido de marcar que no habia stock). Devuelve el stock y ajusta el total. */
export async function quitarItemPedido(itemId: string) {
  const { error } = await supabase.rpc('ingreso_quitar_item_pedido', { p_item: itemId })
  if (error) throw error
}

/** El personal cambia un producto ya pedido por otro (ej. el cliente pidio Coca Zero y queria Original). */
export async function cambiarProductoItem(itemId: string, productoNuevoId: string) {
  const { error } = await supabase.rpc('ingreso_cambiar_producto_item', {
    p_item: itemId,
    p_producto_nuevo: productoNuevoId,
  })
  if (error) throw error
}

export type TipoMerma = 'merma' | 'gasto_operativo'

/**
 * Registra una salida de stock que no es venta: 'merma' (se perdio/echo a perder) o 'gasto_operativo'
 * (se agarro un producto para uso de la tienda). Descuenta el stock y queda con fecha y quien lo hizo.
 */
export async function registrarMerma(productoId: string, cantidad: number, nota: string | undefined, tipo: TipoMerma) {
  const { error } = await supabase.rpc('ingreso_registrar_merma', {
    p_producto: productoId,
    p_cantidad: cantidad,
    p_nota: nota || null,
    p_tipo: tipo,
  })
  if (error) throw error
}

export interface MermaHistorial {
  id: string
  nombre_producto: string
  cantidad: number
  es_peso: boolean
  nota: string | null
  created_at: string
  worker_name: string
  tipo: TipoMerma
}

export async function loadMermasHistorial(dias = 30, tipo?: TipoMerma): Promise<MermaHistorial[]> {
  const { data, error } = await supabase.rpc('ingreso_mermas_historial', { p_dias: dias, p_tipo: tipo || null })
  if (error) throw error
  return (data as MermaHistorial[]) ?? []
}

/** Productos vigentes del catalogo por id (para rearmar un carrito desde un pedido). */
export async function loadProductosPorIds(ids: string[]): Promise<ProductoTienda[]> {
  const { data, error } = await supabase.rpc('ingreso_tienda_productos_por_ids', { p_ids: ids })
  if (error) throw error
  return (data as ProductoTienda[]) ?? []
}

export interface VentaOnline {
  worker_id: string
  nombre: string | null
  fecha: string
  monto: number
}

/** Ventas online pagadas y entregadas, por trabajador que las entrego (el admin ve todas). */
export async function loadVentasOnline(desde: string, hasta: string): Promise<VentaOnline[]> {
  const { data, error } = await supabase.rpc('ingreso_ventas_online', { p_desde: desde, p_hasta: hasta })
  if (error) throw error
  return ((data as VentaOnline[]) ?? []).map((v) => ({ ...v, monto: Number(v.monto) }))
}

/** Vuelve a reservar un pedido online vencido (si aun hay stock) para poder reintentar el pago. */
export async function reactivarPedidoOnline(pedidoId: string) {
  const { error } = await supabase.rpc('ingreso_reactivar_pedido_online', { p_pedido: pedidoId })
  if (error) throw error
}

export interface AbonoDia {
  worker_id: string
  nombre: string | null
  /** Todo lo cobrado en abonos ese dia. */
  monto: number
  /** Los abonos antiguos sin metodo: no estan dentro del arqueo, se suman aparte. */
  monto_aparte: number
}

/** Abonos de deudas cobrados en un dia, por trabajador (el admin ve todos; un trabajador solo los suyos). */
export async function loadAbonosDia(fecha: string): Promise<AbonoDia[]> {
  const { data, error } = await supabase.rpc('ingreso_abonos_dia', { p_fecha: fecha })
  if (error) throw error
  return ((data as AbonoDia[]) ?? []).map((a) => ({ ...a, monto: Number(a.monto), monto_aparte: Number(a.monto_aparte) }))
}

export interface AbonoDetalle {
  id: string
  hora: string
  cliente: string | null
  detalle: string | null
  metodo: string | null
  monto: number
  worker_id: string
  nombre: string | null
}

/** Cada abono cobrado en el dia: de que deuda salio, con que se pago y quien lo cobro. */
export async function loadAbonosDetalleDia(fecha: string): Promise<AbonoDetalle[]> {
  const { data, error } = await supabase.rpc('ingreso_abonos_detalle_dia', { p_fecha: fecha })
  if (error) throw error
  return ((data as AbonoDetalle[]) ?? []).map((a) => ({ ...a, monto: Number(a.monto) }))
}

export interface VentaPedidos {
  worker_id: string
  nombre: string | null
  fecha: string
  metodo: MetodoPago
  monto: number
}

/** Ventas de pedidos de la tienda entregados y cobrados, por trabajador que entrego y metodo de pago. */
export async function loadVentasPedidos(desde: string, hasta: string): Promise<VentaPedidos[]> {
  const { data, error } = await supabase.rpc('ingreso_ventas_pedidos', { p_desde: desde, p_hasta: hasta })
  if (error) throw error
  return ((data as VentaPedidos[]) ?? []).map((v) => ({ ...v, monto: Number(v.monto) }))
}
