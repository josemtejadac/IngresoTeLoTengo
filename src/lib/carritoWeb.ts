/**
 * Carrito de la pagina web (/web). Se guarda en el telefono con la MISMA clave y formato que usa la tienda
 * (/tienda, ver CARRITO_KEY en routes/Tienda.tsx): asi lo que el cliente agrega en la web aparece en la tienda al
 * ir a pagar, y al reves. La tienda revisa precios y stock al cargarlo, asi que aqui solo se guardan ids y cantidades.
 */
const CARRITO_KEY = 'tlt-carrito-v1'
const VIGENCIA_MS = 24 * 60 * 60 * 1000

export interface LineaCarrito {
  producto_id: string
  /** Unidades; en productos por peso: unidades aproximadas (modo 'unidades') o gramos (modo 'gramos'). */
  cantidad: number
  modo?: 'unidades' | 'gramos'
  /** Se compra por pack (ej. 3 x $1000): cantidad son packs. */
  esCombo?: boolean
}

export function leerCarrito(): LineaCarrito[] {
  try {
    const raw = localStorage.getItem(CARRITO_KEY)
    if (!raw) return []
    const c = JSON.parse(raw) as { guardado: number; lineas: LineaCarrito[] }
    if (!Array.isArray(c.lineas) || Date.now() - c.guardado > VIGENCIA_MS) return []
    return c.lineas.filter((l) => typeof l.producto_id === 'string' && l.cantidad > 0)
  } catch {
    return []
  }
}

export function guardarCarrito(lineas: LineaCarrito[]) {
  try {
    if (lineas.length === 0) localStorage.removeItem(CARRITO_KEY)
    else localStorage.setItem(CARRITO_KEY, JSON.stringify({ guardado: Date.now(), lineas }))
  } catch {
    // sin almacenamiento: el carrito simplemente no se guarda
  }
}

/** Misma linea del carrito (mismo producto y misma forma de compra). */
export function mismaLinea(a: LineaCarrito, b: Pick<LineaCarrito, 'producto_id' | 'esCombo'>): boolean {
  return a.producto_id === b.producto_id && !!a.esCombo === !!b.esCombo
}
