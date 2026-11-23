import { supabase } from './supabase'

export interface HoraDia {
  h: number
  m: number
}

export interface HorarioDia {
  abre: HoraDia
  cierra: HoraDia
  /** true = ese dia no se atiende. */
  cerrado?: boolean
}

/**
 * Horario de atencion (hora de Chile). Claves: 0=domingo..6=sabado (igual que Date.getDay()).
 * Estos son los valores de siempre: se usan mientras no se haya podido leer el horario que el admin dejo guardado
 * (sin internet, o si aun no existe) para que la tienda nunca quede sin horario.
 */
const POR_DEFECTO: HorarioDia = { abre: { h: 8, m: 30 }, cierra: { h: 22, m: 50 } }
const BASE_POR_DIA: Record<number, HorarioDia> = {
  0: { abre: { h: 8, m: 30 }, cierra: { h: 22, m: 0 } }, // domingo
  6: { abre: { h: 9, m: 0 }, cierra: { h: 22, m: 0 } }, // sabado
}

function semanaBase(): Record<number, HorarioDia> {
  const s: Record<number, HorarioDia> = {}
  for (let d = 0; d <= 6; d++) s[d] = BASE_POR_DIA[d] ?? POR_DEFECTO
  return s
}

// Lo que el admin dejo guardado. Se pone al dia con cargarHorarioTienda().
let semana: Record<number, HorarioDia> = semanaBase()
/** Cambios para una fecha puntual (AAAA-MM-DD, hora de Chile): solo rigen ese dia. */
let excepciones: Record<string, HorarioDia> = {}

const CLAVE_CACHE = 'tlt-horario-tienda-v1'

interface FilaSemana {
  dow: number
  abre: string | null
  cierra: string | null
  cerrado: boolean
}
interface FilaExcepcion {
  fecha: string
  abre: string | null
  cierra: string | null
  cerrado: boolean
}
interface HorarioGuardado {
  semana: FilaSemana[]
  excepciones: FilaExcepcion[]
}

/** "08:30" o "08:30:00" -> { h: 8, m: 30 }. */
export function parseHora(txt: string | null | undefined): HoraDia | null {
  if (!txt) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(txt)
  if (!m) return null
  return { h: Number(m[1]), m: Number(m[2]) }
}

/** { h: 8, m: 30 } -> "08:30" (formato de los campos de hora). */
export function horaAInput(h: HoraDia): string {
  return `${String(h.h).padStart(2, '0')}:${String(h.m).padStart(2, '0')}`
}

function aFila(abre: string | null, cierra: string | null, cerrado: boolean, respaldo: HorarioDia): HorarioDia {
  if (cerrado) return { abre: respaldo.abre, cierra: respaldo.cierra, cerrado: true }
  const a = parseHora(abre)
  const c = parseHora(cierra)
  if (!a || !c || c.h * 60 + c.m <= a.h * 60 + a.m) return respaldo
  return { abre: a, cierra: c }
}

function aplicar(datos: HorarioGuardado): void {
  const nueva = semanaBase()
  for (const f of datos.semana ?? []) {
    if (f.dow >= 0 && f.dow <= 6) nueva[f.dow] = aFila(f.abre, f.cierra, f.cerrado, nueva[f.dow])
  }
  const exc: Record<string, HorarioDia> = {}
  for (const f of datos.excepciones ?? []) {
    exc[f.fecha] = aFila(f.abre, f.cierra, f.cerrado, POR_DEFECTO)
  }
  semana = nueva
  excepciones = exc
}

// Al abrir, se parte con lo ultimo que se supo (si no hay internet la tienda igual sabe su horario).
try {
  const guardado = localStorage.getItem(CLAVE_CACHE)
  if (guardado) aplicar(JSON.parse(guardado) as HorarioGuardado)
} catch {
  // sin almacenamiento: se usa el horario de siempre hasta poder leerlo
}

/**
 * Lee el horario que dejo el admin (una sola consulta liviana). Si falla (sin internet, o aun no esta activado),
 * se queda con el ultimo horario conocido. Devuelve true si pudo leerlo.
 */
export async function cargarHorarioTienda(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('ingreso_tienda_horario')
    if (error || !data) return false
    const datos = data as HorarioGuardado
    aplicar(datos)
    try {
      localStorage.setItem(CLAVE_CACHE, JSON.stringify(datos))
    } catch {
      // sin almacenamiento
    }
    return true
  } catch {
    return false
  }
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

/** Minutos transcurridos del dia en Chile (ej. 8:30 = 510). */
export function minutosAhoraChile(fecha: Date = new Date()): number {
  return partesChile(fecha).minutos
}

/** Fecha de hoy en Chile, AAAA-MM-DD. */
export function fechaChile(fecha: Date = new Date()): string {
  // en-CA entrega el formato AAAA-MM-DD.
  return fecha.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
}

/** Horario de la semana tal como esta hoy (para mostrarlo y editarlo en el panel del admin). */
export function horarioSemanaActual(): Record<number, HorarioDia> {
  return semana
}

function horarioDelDia(diaSemana: number, fechaISO?: string): HorarioDia {
  return (fechaISO ? excepciones[fechaISO] : undefined) ?? semana[diaSemana] ?? POR_DEFECTO
}

/** Horario de hoy (con el cambio puntual de la fecha, si lo hay). */
export function horarioDeHoy(fecha: Date = new Date()): HorarioDia {
  const { diaSemana } = partesChile(fecha)
  return horarioDelDia(diaSemana, fechaChile(fecha))
}

/** true si la tienda esta recibiendo pedidos ahora mismo (hora de Chile, segun el dia que sea). */
export function tiendaAbierta(fecha: Date = new Date()): boolean {
  const { minutos, diaSemana } = partesChile(fecha)
  const h = horarioDelDia(diaSemana, fechaChile(fecha))
  if (h.cerrado) return false
  return minutos >= h.abre.h * 60 + h.abre.m && minutos < h.cierra.h * 60 + h.cierra.m
}

/** true si hoy no se atiende en todo el dia. */
export function cerradoTodoHoy(fecha: Date = new Date()): boolean {
  return horarioDeHoy(fecha).cerrado === true
}

/** Texto "8:30 a 22:50" con el horario de HOY (cambia solo segun el dia). */
export function horarioHoyTexto(fecha: Date = new Date()): string {
  const h = horarioDeHoy(fecha)
  if (h.cerrado) return 'cerrado todo el día'
  return `${horaTexto(h.abre)} a ${horaTexto(h.cierra)}`
}

/** "Recibimos pedidos de 8:30 a 22:50." o "Hoy no recibimos pedidos." */
export function frasePedidosHoy(fecha: Date = new Date()): string {
  return cerradoTodoHoy(fecha) ? 'Hoy no recibimos pedidos.' : `Recibimos pedidos de ${horarioHoyTexto(fecha)}.`
}

/** "Atendemos hoy de 8:30 a 22:50" o "Hoy no atendemos". */
export function fraseAtencionHoy(fecha: Date = new Date()): string {
  return cerradoTodoHoy(fecha) ? 'Hoy no atendemos' : `Atendemos hoy de ${horarioHoyTexto(fecha)}`
}

/** "hoy de 8:30 a 22:50" o "hoy no atendemos" (para frases como "Abierto ahora · hoy de ..."). */
export function fraseHoyDe(fecha: Date = new Date()): string {
  return cerradoTodoHoy(fecha) ? 'hoy no atendemos' : `hoy de ${horarioHoyTexto(fecha)}`
}

export const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

function mismoHorario(a: HorarioDia, b: HorarioDia): boolean {
  if (a.cerrado || b.cerrado) return !!a.cerrado && !!b.cerrado
  return a.abre.h === b.abre.h && a.abre.m === b.abre.m && a.cierra.h === b.cierra.h && a.cierra.m === b.cierra.m
}

/** Texto con el horario de todos los dias, agrupando los que comparten el mismo horario. */
export function horarioSemanaTexto(): string {
  const grupos: { dias: number[]; horario: HorarioDia }[] = []
  for (let d = 0; d <= 6; d++) {
    const h = semana[d] ?? POR_DEFECTO
    const existente = grupos.find((g) => mismoHorario(g.horario, h))
    if (existente) existente.dias.push(d)
    else grupos.push({ dias: [d], horario: h })
  }
  return grupos
    .map((g) => {
      const nombres =
        g.dias.length > 1 && g.dias.every((d, i) => i === 0 || d === g.dias[i - 1] + 1)
          ? `${NOMBRES_DIA[g.dias[0]]} a ${NOMBRES_DIA[g.dias[g.dias.length - 1]]}`
          : g.dias.map((d) => NOMBRES_DIA[d]).join(', ')
      return g.horario.cerrado
        ? `${nombres} cerrado`
        : `${nombres} ${horaTexto(g.horario.abre)}-${horaTexto(g.horario.cierra)}`
    })
    .join(' · ')
}
