/**
 * Calendario de limpieza por dia del mes (no por dia de la semana): el admin solo armo 3 planificaciones
 * (octubre, noviembre, diciembre 2026) para que se reutilicen rotando cada 3 meses, siempre en el mismo orden.
 * Enero usa la de octubre, febrero la de noviembre, marzo la de diciembre, abril vuelve a octubre, etc.
 */
export interface TareaPlanificada {
  dia: number
  tarea: string
  trabajador: string
}

const PLANTILLA_OCTUBRE: TareaPlanificada[] = [
  { dia: 2, tarea: 'Baño', trabajador: 'Ricardo' },
  { dia: 6, tarea: 'Pasillo, carriles de las ventanas', trabajador: 'Darlin' },
  { dia: 8, tarea: 'Neveras de refrescos y jugos', trabajador: 'Ricardo' },
  { dia: 9, tarea: 'Nevera gris', trabajador: 'Darlin' },
  { dia: 13, tarea: 'Baño', trabajador: 'Ricardo' },
  { dia: 15, tarea: '½ Anaquel', trabajador: 'Darlin' },
  { dia: 16, tarea: '½ Anaquel', trabajador: 'Ricardo' },
  { dia: 20, tarea: 'Baño', trabajador: 'Darlin' },
  { dia: 22, tarea: 'Sala/Cuarto', trabajador: 'Ricardo' },
  { dia: 23, tarea: 'Percolador (cafetera)', trabajador: 'Darlin' },
  { dia: 27, tarea: 'Pasillo, posa manos', trabajador: 'Ricardo' },
  { dia: 29, tarea: 'Sala/Habitación', trabajador: 'Darlin' },
  { dia: 30, tarea: 'Ventanas', trabajador: 'Ricardo' },
]

const PLANTILLA_NOVIEMBRE: TareaPlanificada[] = [
  { dia: 3, tarea: 'Pasillo, carriles de las ventanas', trabajador: 'Ricardo' },
  { dia: 5, tarea: 'Neveras de refrescos y jugos', trabajador: 'Darlin' },
  { dia: 6, tarea: 'Nevera gris', trabajador: 'Ricardo' },
  { dia: 10, tarea: 'Baño', trabajador: 'Darlin' },
  { dia: 12, tarea: '½ Anaquel', trabajador: 'Ricardo' },
  { dia: 13, tarea: '½ Anaquel', trabajador: 'Darlin' },
  { dia: 17, tarea: 'Baño', trabajador: 'Ricardo' },
  { dia: 19, tarea: 'Sala/Cuarto', trabajador: 'Darlin' },
  { dia: 20, tarea: 'Percolador (cafetera)', trabajador: 'Ricardo' },
  { dia: 24, tarea: 'Pasillo, posa manos', trabajador: 'Darlin' },
  { dia: 26, tarea: 'Sala/Habitación', trabajador: 'Ricardo' },
  { dia: 27, tarea: 'Ventanas', trabajador: 'Darlin' },
]

const PLANTILLA_DICIEMBRE: TareaPlanificada[] = [
  { dia: 1, tarea: 'Pasillo, carriles de las ventanas', trabajador: 'Darlin' },
  { dia: 3, tarea: 'Neveras de refrescos y jugos', trabajador: 'Ricardo' },
  { dia: 4, tarea: 'Nevera gris', trabajador: 'Darlin' },
  { dia: 8, tarea: 'Baño', trabajador: 'Ricardo' },
  { dia: 10, tarea: '½ Anaquel', trabajador: 'Darlin' },
  { dia: 11, tarea: '½ Anaquel', trabajador: 'Ricardo' },
  { dia: 15, tarea: 'Baño', trabajador: 'Darlin' },
  { dia: 17, tarea: 'Sala/Cuarto', trabajador: 'Ricardo' },
  { dia: 18, tarea: 'Percolador (cafetera)', trabajador: 'Darlin' },
  { dia: 22, tarea: 'Pasillo, posa manos', trabajador: 'Ricardo' },
  { dia: 24, tarea: 'Sala/Habitación', trabajador: 'Darlin' },
  { dia: 25, tarea: 'Ventanas', trabajador: 'Ricardo' },
  { dia: 29, tarea: 'Pasillo, carriles de las ventanas', trabajador: 'Darlin' },
  { dia: 31, tarea: 'Neveras de refrescos y jugos', trabajador: 'Ricardo' },
]

const PLANTILLAS = [PLANTILLA_OCTUBRE, PLANTILLA_NOVIEMBRE, PLANTILLA_DICIEMBRE]
const NOMBRES_PLANTILLA = ['octubre', 'noviembre', 'diciembre']

/** Mes 1-12 -> que plantilla le toca (0=octubre, 1=noviembre, 2=diciembre), rotando cada 3 meses. */
function indicePlantilla(mes1a12: number): number {
  return (mes1a12 - 1) % 3
}

export function plantillaDelMes(fecha: Date): { nombre: string; tareas: TareaPlanificada[] } {
  const i = indicePlantilla(fecha.getMonth() + 1)
  return { nombre: NOMBRES_PLANTILLA[i], tareas: PLANTILLAS[i] }
}

/** La tarea planificada para un dia puntual, o null si ese dia no hay nada agendado. */
export function tareaDelDia(fecha: Date): TareaPlanificada | null {
  const { tareas } = plantillaDelMes(fecha)
  return tareas.find((t) => t.dia === fecha.getDate()) ?? null
}
