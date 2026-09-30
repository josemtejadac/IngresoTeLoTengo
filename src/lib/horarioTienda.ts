interface HoraDia {
  h: number
  m: number
}

interface HorarioDia {
  abre: HoraDia
  cierra: HoraDia
}

/**
 * Horario de atencion (hora de Chile) por dia de la semana. Claves: 0=domingo..6=sabado (igual que
 * Date.getDay()). Lunes a viernes usan el horario por defecto si no tienen su propia entrada.
 */
const HORARIO_POR_DEFECTO: HorarioDia = { abre: { h: 8, m: 30 }, cierra: { h: 22, m: 50 } }
const HORARIO_POR_DIA: Partial<Record<number, HorarioDia>> = {
  0: { abre: { h: 8, m: 30 }, cierra: { h: 22, m: 0 } }, // domingo
  6: { abre: { h: 9, m: 0 }, cierra: { h: 22, m: 0 } }, // sabado
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function horaTexto(h: HoraDia): string {
  return `${h.h}:${pad(h.m)}`
}

function partesChile(fecha: Date): { minutos: number; diaSemana: number } {
  const partes = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(fecha)
  const h = Number(partes.find((p) => p.type === 'hour')?.value ?? '0')
  const m = Number(partes.find((p) => p.type === 'minute')?.value ?? '0')
  // El nombre corto en es-CL viene como "dom", "lun", "mar", ... (a veces con punto).
  const nombreDia = (partes.find((p) => p.type === 'weekday')?.value ?? '').toLowerCase().replace('.', '')
  const dias: Record<string, number> = { dom: 0, lun: 1, mar: 2, mié: 3, mie: 3, jue: 4, vie: 5, sáb: 6, sab: 6 }
  return { minutos: h * 60 + m, diaSemana: dias[nombreDia] ?? new Date().getDay() }
}

function horarioDelDia(diaSemana: number): HorarioDia {
  return HORARIO_POR_DIA[diaSemana] ?? HORARIO_POR_DEFECTO
}

/** true si la tienda esta recibiendo pedidos ahora mismo (hora de Chile, segun el dia que sea). */
export function tiendaAbierta(fecha: Date = new Date()): boolean {
  const { minutos, diaSemana } = partesChile(fecha)
  const h = horarioDelDia(diaSemana)
  return minutos >= h.abre.h * 60 + h.abre.m && minutos < h.cierra.h * 60 + h.cierra.m
}

/** Texto "8:30 a 22:50" con el horario de HOY (cambia solo segun el dia). */
export function horarioHoyTexto(fecha: Date = new Date()): string {
  const { diaSemana } = partesChile(fecha)
  const h = horarioDelDia(diaSemana)
  return `${horaTexto(h.abre)} a ${horaTexto(h.cierra)}`
}

const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

/** Texto con el horario de todos los dias, agrupando los que comparten el mismo horario. */
export function horarioSemanaTexto(): string {
  const grupos: { dias: number[]; horario: HorarioDia }[] = []
  for (let d = 0; d <= 6; d++) {
    const h = horarioDelDia(d)
    const existente = grupos.find((g) => g.horario.abre.h === h.abre.h && g.horario.abre.m === h.abre.m && g.horario.cierra.h === h.cierra.h && g.horario.cierra.m === h.cierra.m)
    if (existente) existente.dias.push(d)
    else grupos.push({ dias: [d], horario: h })
  }
  return grupos
    .map((g) => {
      const nombres =
        g.dias.length > 1 && g.dias.every((d, i) => i === 0 || d === g.dias[i - 1] + 1)
          ? `${NOMBRES_DIA[g.dias[0]]} a ${NOMBRES_DIA[g.dias[g.dias.length - 1]]}`
          : g.dias.map((d) => NOMBRES_DIA[d]).join(', ')
      return `${nombres} ${horaTexto(g.horario.abre)}-${horaTexto(g.horario.cierra)}`
    })
    .join(' · ')
}
