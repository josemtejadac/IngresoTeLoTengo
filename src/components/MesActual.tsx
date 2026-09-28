const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/** Barra con el mes actual, arriba de todo. Se actualiza sola: siempre lee la fecha de hoy. */
export function MesActual() {
  const hoy = new Date()
  return (
    <div className="mes-actual">
      {MESES[hoy.getMonth()]} {hoy.getFullYear()}
    </div>
  )
}
