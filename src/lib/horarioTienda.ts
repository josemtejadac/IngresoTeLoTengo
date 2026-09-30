/** La tienda recibe pedidos entre estas horas (hora de Chile). */
export const TIENDA_ABRE = { h: 8, m: 30 }
export const TIENDA_CIERRA = { h: 22, m: 50 }

function minutosChile(fecha: Date): number {
  const partes = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(fecha)
  const h = Number(partes.find((p) => p.type === 'hour')?.value ?? '0')
  const m = Number(partes.find((p) => p.type === 'minute')?.value ?? '0')
  return h * 60 + m
}

/** true si la tienda esta recibiendo pedidos ahora mismo (hora de Chile). */
export function tiendaAbierta(fecha: Date = new Date()): boolean {
  const min = minutosChile(fecha)
  return min >= TIENDA_ABRE.h * 60 + TIENDA_ABRE.m && min < TIENDA_CIERRA.h * 60 + TIENDA_CIERRA.m
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export const TIENDA_ABRE_TEXTO = `${TIENDA_ABRE.h}:${pad(TIENDA_ABRE.m)}`
export const TIENDA_CIERRA_TEXTO = `${TIENDA_CIERRA.h}:${pad(TIENDA_CIERRA.m)}`
