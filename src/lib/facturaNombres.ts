// IMPORTANTE: esta normalizacion es identica a la de la funcion ingreso-leer-factura.
// Sirve para "recordar" que una linea de factura corresponde a cierto producto (alias).
const RUIDO = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'c', 'r', 'un', 'uni', 'unid', 'unidad', 'unidades',
  'kilo', 'kilos', 'kg', 'kgs', 'k', 'x', 'bolsa', 'bolsas', 'malla', 'caja', 'bandeja', 'paquete', 'paquetes',
  'pqte', 'pqt', 'granel', 'extra', 'g', 'gr', 'grs', 'gramo', 'gramos', 'ml', 'cc', 'lt', 'lts', 'l',
])

export function tokensProducto(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !RUIDO.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
}

export function claveAlias(s: string): string {
  return [...new Set(tokensProducto(s))].sort().join(' ')
}

const UNIDADES_KILO = ['kg', 'kgs', 'kilo', 'kilos']
const UNIDADES_GRAMO = ['g', 'gr', 'grs', 'gramo', 'gramos']
const UNIDADES_UNIDAD = ['un', 'uni', 'unid', 'unidad', 'unidades', 'u']

export function esKilo(u: string): boolean {
  return UNIDADES_KILO.includes(u)
}

/**
 * Convierte lo que dice la factura a la unidad en que se cuenta el stock del producto:
 * productos por peso = gramos; el resto = unidades.
 */
export function convertirCantidad(
  cantidad: number,
  unidadFactura: string,
  producto: { por_peso: boolean; gramos_unidad: number | null } | undefined,
): { cantidad: number; nota: string } {
  if (!producto) return { cantidad, nota: '' }
  if (producto.por_peso) {
    if (UNIDADES_KILO.includes(unidadFactura)) {
      return { cantidad: Math.round(cantidad * 1000), nota: `${cantidad} kg = ${Math.round(cantidad * 1000)} g` }
    }
    if (UNIDADES_GRAMO.includes(unidadFactura)) {
      return { cantidad: Math.round(cantidad), nota: `${Math.round(cantidad)} g` }
    }
    if (UNIDADES_UNIDAD.includes(unidadFactura) && producto.gramos_unidad) {
      return {
        cantidad: Math.round(cantidad * producto.gramos_unidad),
        nota: `${cantidad} un × ${producto.gramos_unidad} g`,
      }
    }
    return {
      cantidad: 0,
      nota: 'Este producto se vende por peso: escribe cuántos gramos en total vienen en la factura.',
    }
  }
  if (UNIDADES_KILO.includes(unidadFactura)) {
    return { cantidad, nota: 'Ojo: la factura dice kilos y este producto se cuenta en unidades. Revisa la cantidad.' }
  }
  return { cantidad, nota: '' }
}
