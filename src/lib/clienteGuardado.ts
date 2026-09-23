export interface Direccion {
  torre: string
  depto: string
}

export interface ClienteGuardado {
  nombre: string
  telefono: string
  direcciones: Direccion[]
  /** Indice de la direccion usada en el ultimo pedido. */
  ultima: number
}

const KEY = 'tlt_cliente'

export function loadClienteGuardado(): ClienteGuardado | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as ClienteGuardado
    if (!c.nombre || !c.telefono || !Array.isArray(c.direcciones)) return null
    return c
  } catch {
    return null
  }
}

/** Guarda datos del cliente; agrega la direccion si es nueva y la marca como ultima usada. */
export function guardarCliente(params: {
  nombre: string
  telefono: string
  torre: string
  depto: string
}) {
  try {
    const prev = loadClienteGuardado()
    const direcciones = prev?.direcciones ?? []
    const torre = params.torre.trim()
    const depto = params.depto.trim()
    let idx = direcciones.findIndex(
      (d) => d.torre.toLowerCase() === torre.toLowerCase() && d.depto.toLowerCase() === depto.toLowerCase(),
    )
    if (idx === -1) {
      direcciones.push({ torre, depto })
      idx = direcciones.length - 1
    }
    const c: ClienteGuardado = {
      nombre: params.nombre.trim(),
      telefono: params.telefono.trim(),
      direcciones,
      ultima: idx,
    }
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    // sin almacenamiento disponible: el pedido igual se envia
  }
}

export function olvidarCliente() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nada que hacer
  }
}
