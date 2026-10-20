import { marcarEntregaFisica, marcarPedidoTiendaEntregado, type PedidoTienda, type PedidoTiendaItem } from './tienda'

/**
 * Respaldo para cuando se va la señal: la ultima lista de pedidos queda guardada en el telefono (se ve igual aunque
 * se recargue la app), y las entregas marcadas sin señal quedan en una cola que se envia sola al volver internet.
 */

const CACHE_KEY = 'tlt-pedidos-cache-v1'
const COLA_KEY = 'tlt-pedidos-cola-v1'

export interface CachePedidos {
  pedidos: PedidoTienda[]
  items: Record<string, PedidoTiendaItem[]>
  fotos: Record<string, string | null>
  guardado: number
}

export function leerCache(): CachePedidos | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as CachePedidos) : null
  } catch {
    return null
  }
}

export function guardarCache(c: Omit<CachePedidos, 'guardado'>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...c, guardado: Date.now() }))
  } catch {
    // sin espacio o sin almacenamiento: simplemente no se guarda
  }
}

export type AccionOffline =
  | { tipo: 'entregado'; id: string; cuando: number }
  | { tipo: 'entrega_fisica'; id: string; entregar: boolean; cuando: number }

export function leerCola(): AccionOffline[] {
  try {
    const raw = localStorage.getItem(COLA_KEY)
    const lista = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(lista) ? (lista as AccionOffline[]) : []
  } catch {
    return []
  }
}

function guardarCola(c: AccionOffline[]) {
  try {
    localStorage.setItem(COLA_KEY, JSON.stringify(c))
  } catch {
    // sin almacenamiento
  }
}

export function encolar(a: AccionOffline) {
  // Una misma accion sobre el mismo pedido no se repite.
  const cola = leerCola().filter((x) => !(x.tipo === a.tipo && x.id === a.id))
  guardarCola([...cola, a])
}

/** true si el fallo es de conexion (sin señal), no un rechazo real del servidor. */
export function esErrorDeRed(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = (err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)).toLowerCase()
  return /failed to fetch|networkerror|load failed|network request failed|fetch|timeout|timed out|offline/.test(msg)
}

/** Espera maximo `ms`: con señal muy mala una peticion puede quedar colgada; se trata como falta de señal. */
export function conTiempo<T>(p: Promise<T>, ms = 10000): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rechazar) => setTimeout(() => rechazar(new Error('timeout de red')), ms))])
}

let procesando = false

/** Envia las acciones guardadas. Se detiene al primer fallo de conexion; descarta las que el servidor rechaza. Devuelve cuantas se enviaron. */
export async function procesarCola(): Promise<number> {
  if (procesando) return 0
  procesando = true
  let enviadas = 0
  try {
    let cola = leerCola()
    for (const a of cola) {
      try {
        if (a.tipo === 'entregado') await conTiempo(marcarPedidoTiendaEntregado(a.id))
        else await conTiempo(marcarEntregaFisica(a.id, a.entregar))
        enviadas++
      } catch (err) {
        if (esErrorDeRed(err)) break // sigue sin señal: se reintenta mas tarde
        // El servidor la rechazo (ej. el pedido ya estaba entregado por otra persona): se descarta para no trabarse.
      }
      cola = cola.filter((x) => !(x.tipo === a.tipo && x.id === a.id))
      guardarCola(cola)
    }
  } finally {
    procesando = false
  }
  return enviadas
}
