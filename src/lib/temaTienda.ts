/**
 * Temas de temporada de la tienda (solo el aspecto, no cambia nada mas). Cada tema tiene fecha de inicio y de
 * termino en hora de Chile: fuera de esas fechas la tienda se ve normal sola, sin tener que cambiar nada.
 */
const HALLOWEEN_DESDE = '2026-10-28'
/** Primer dia en que la tienda ya vuelve a la normalidad. */
const HALLOWEEN_HASTA = '2026-11-05'

function hoyChile(): string {
  // en-CA da el formato YYYY-MM-DD.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
}

export function esTemaHalloween(): boolean {
  const hoy = hoyChile()
  return hoy >= HALLOWEEN_DESDE && hoy < HALLOWEEN_HASTA
}

/** Categorias que van primero y resaltadas en la tienda mientras dura su temporada. */
export function categoriasDestacadas(): string[] {
  return esTemaHalloween() ? ['HALLOWEEN'] : []
}
