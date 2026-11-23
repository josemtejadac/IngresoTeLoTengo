import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  NOMBRES_DIA,
  cargarHorarioTienda,
  fechaChile,
  fraseAtencionHoy,
  horaAInput,
  horarioDeHoy,
  minutosAhoraChile,
  parseHora,
  tiendaAbierta,
} from '../lib/horarioTienda'

interface FilaDia {
  dow: number
  abre: string
  cierra: string
  cerrado: boolean
}

interface Excepcion {
  fecha: string
  abre: string | null
  cierra: string | null
  cerrado: boolean
}

// Lunes primero, domingo al final.
const ORDEN = [1, 2, 3, 4, 5, 6, 0]

function recortar(hora: string | null): string {
  return (hora ?? '').slice(0, 5)
}

function minutos(hora: string): number {
  const h = parseHora(hora)
  return h ? h.h * 60 + h.m : NaN
}

function sinCero(hora: string): string {
  const h = parseHora(hora)
  return h ? `${h.h}:${String(h.m).padStart(2, '0')}` : hora
}

function fechaLinda(fecha: string): string {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

function diaDe(fecha: string): number {
  return new Date(`${fecha}T12:00:00`).getDay()
}

/**
 * Horario de la tienda para el admin: se ve lo que rige hoy y se puede cambiar el horario de cada dia, cerrar un dia
 * puntual, o cerrar la tienda ahora. La tienda de los clientes y el servidor usan este mismo horario.
 */
export function HorarioTiendaAdmin() {
  const [abierto, setAbierto] = useState(false)
  const [semana, setSemana] = useState<FilaDia[]>([])
  const [excepciones, setExcepciones] = useState<Excepcion[]>([])
  const [activado, setActivado] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const hoy = fechaChile()
  const [exFecha, setExFecha] = useState(hoy)
  const [exAbre, setExAbre] = useState('')
  const [exCierra, setExCierra] = useState('')
  const [exCerrado, setExCerrado] = useState(false)

  const cargar = useCallback(async () => {
    const { data, error: errSemana } = await supabase.from('ingreso_horario_tienda').select('*').order('dow')
    if (errSemana) {
      // La tabla aun no existe (falta correr el SQL): el resto de la tienda sigue con el horario de siempre.
      setActivado(false)
      return
    }
    setActivado(true)
    setSemana(
      ((data as { dow: number; abre: string; cierra: string; cerrado: boolean }[]) ?? []).map((f) => ({
        dow: f.dow,
        abre: recortar(f.abre),
        cierra: recortar(f.cierra),
        cerrado: f.cerrado,
      })),
    )
    const { data: ex } = await supabase
      .from('ingreso_horario_excepciones')
      .select('*')
      .gte('fecha', fechaChile())
      .order('fecha')
    setExcepciones(
      ((ex as { fecha: string; abre: string | null; cierra: string | null; cerrado: boolean }[]) ?? []).map((f) => ({
        fecha: f.fecha,
        abre: f.abre ? recortar(f.abre) : null,
        cierra: f.cierra ? recortar(f.cierra) : null,
        cerrado: f.cerrado,
      })),
    )
    await cargarHorarioTienda()
    setTick((n) => n + 1)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  // El letrero "Abierta ahora / Cerrada ahora" se mantiene al dia con la hora.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  // Al elegir la fecha del cambio puntual, se parte con el horario normal de ese dia.
  useEffect(() => {
    const f = semana.find((d) => d.dow === diaDe(exFecha))
    if (f) {
      setExAbre(f.abre)
      setExCierra(f.cierra)
    }
  }, [exFecha, semana])

  function cambiarDia(dow: number, cambio: Partial<FilaDia>) {
    setSemana((prev) => prev.map((f) => (f.dow === dow ? { ...f, ...cambio } : f)))
    setAviso(null)
  }

  async function ejecutar(accion: () => Promise<void>, mensaje: string) {
    setBusy(true)
    setError(null)
    setAviso(null)
    try {
      await accion()
      await cargar()
      setAviso(mensaje)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el horario')
    } finally {
      setBusy(false)
    }
  }

  function guardarSemana() {
    for (const f of semana) {
      if (!f.cerrado && !(minutos(f.cierra) > minutos(f.abre))) {
        setError(`${NOMBRES_DIA[f.dow]}: la hora de cierre debe ser después de la de apertura.`)
        return
      }
    }
    ejecutar(async () => {
      const { error: e } = await supabase.from('ingreso_horario_tienda').upsert(
        semana.map((f) => ({ dow: f.dow, abre: f.abre, cierra: f.cierra, cerrado: f.cerrado, updated_at: new Date().toISOString() })),
        { onConflict: 'dow' },
      )
      if (e) throw e
    }, 'Horario guardado. La tienda ya usa este horario.')
  }

  function aplicarCambioPuntual() {
    if (!exFecha || exFecha < hoy) {
      setError('Elige hoy o una fecha futura.')
      return
    }
    if (!exCerrado && !(minutos(exCierra) > minutos(exAbre))) {
      setError('La hora de cierre debe ser después de la de apertura.')
      return
    }
    ejecutar(async () => {
      const { error: e } = await supabase.from('ingreso_horario_excepciones').upsert(
        { fecha: exFecha, abre: exCerrado ? null : exAbre, cierra: exCerrado ? null : exCierra, cerrado: exCerrado },
        { onConflict: 'fecha' },
      )
      if (e) throw e
    }, exCerrado ? 'Listo: ese día la tienda queda cerrada.' : 'Listo: ese día la tienda usa el horario indicado.')
  }

  function quitarCambio(fecha: string) {
    ejecutar(async () => {
      const { error: e } = await supabase.from('ingreso_horario_excepciones').delete().eq('fecha', fecha)
      if (e) throw e
    }, 'Cambio quitado: ese día vuelve al horario normal.')
  }

  function cerrarAhora() {
    const h = horarioDeHoy()
    const ahora = minutosAhoraChile()
    if (!tiendaAbierta() && !h.cerrado && ahora >= h.cierra.h * 60 + h.cierra.m) {
      setError('La tienda ya está cerrada por hoy.')
      return
    }
    if (!window.confirm('¿Cerrar la tienda ahora? Los clientes ya no podrán hacer pedidos hasta que la reabras o hasta mañana.')) return
    const antesDeAbrir = ahora <= h.abre.h * 60 + h.abre.m
    ejecutar(async () => {
      const cierraAhora = `${String(Math.floor(ahora / 60)).padStart(2, '0')}:${String(ahora % 60).padStart(2, '0')}`
      const { error: e } = await supabase.from('ingreso_horario_excepciones').upsert(
        antesDeAbrir || h.cerrado
          ? { fecha: fechaChile(), abre: null, cierra: null, cerrado: true }
          : { fecha: fechaChile(), abre: horaAInput(h.abre), cierra: cierraAhora, cerrado: false },
        { onConflict: 'fecha' },
      )
      if (e) throw e
    }, 'Tienda cerrada. Para reabrirla, quita el cambio de hoy en la lista de abajo.')
  }

  const abiertaAhora = tiendaAbierta()
  const hayCambioHoy = excepciones.some((x) => x.fecha === hoy)

  return (
    <section className="card horario-admin">
      <div className="section-header">
        <div>
          <h2>🕒 Horario de la tienda</h2>
          <p className="subtitle">
            {activado === null ? (
              'Cargando horario…'
            ) : (
              <>
                <span className={abiertaAhora ? 'horario-estado abierta' : 'horario-estado cerrada'}>
                  {abiertaAhora ? '● Abierta ahora' : '● Cerrada ahora'}
                </span>{' '}
                · {fraseAtencionHoy()}
                {hayCambioHoy && ' (cambio de hoy)'}
              </>
            )}
          </p>
        </div>
        <div className="table-controls">
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto((v) => !v)}>
            {abierto ? 'Cerrar ▴' : 'Cambiar horario ▾'}
          </button>
        </div>
      </div>

      {activado === false && (
        <p className="error-text">
          Esta función aún no está activada en la base de datos (falta correr el SQL horario_tienda.sql). Mientras tanto la
          tienda usa el horario de siempre.
        </p>
      )}

      {abierto && activado && (
        <>
          <h3 className="horario-titulo">Horario de cada día</h3>
          <div className="horario-dias">
            {ORDEN.map((dow) => {
              const f = semana.find((d) => d.dow === dow)
              if (!f) return null
              return (
                <div key={dow} className="horario-fila">
                  <strong className="horario-dia">{NOMBRES_DIA[dow]}</strong>
                  <input
                    type="time"
                    aria-label={`${NOMBRES_DIA[dow]}: abre`}
                    value={f.abre}
                    disabled={f.cerrado}
                    onChange={(e) => cambiarDia(dow, { abre: e.target.value })}
                  />
                  <span className="horario-a">a</span>
                  <input
                    type="time"
                    aria-label={`${NOMBRES_DIA[dow]}: cierra`}
                    value={f.cierra}
                    disabled={f.cerrado}
                    onChange={(e) => cambiarDia(dow, { cierra: e.target.value })}
                  />
                  <span className="horario-cerrado">
                    <input
                      type="checkbox"
                      id={`hc-${dow}`}
                      checked={f.cerrado}
                      onChange={(e) => cambiarDia(dow, { cerrado: e.target.checked })}
                    />
                    <label htmlFor={`hc-${dow}`}>Cerrado</label>
                  </span>
                </div>
              )
            })}
          </div>
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={guardarSemana}>
            {busy ? 'Guardando...' : 'Guardar horario'}
          </button>

          <h3 className="horario-titulo">Cambio solo por un día</h3>
          <p className="subtitle">Por ejemplo, hoy cerrar a las 21:00. Al día siguiente vuelve solo al horario normal.</p>
          <div className="horario-fila horario-cambio">
            <input
              type="date"
              aria-label="Fecha del cambio"
              value={exFecha}
              min={hoy}
              onChange={(e) => setExFecha(e.target.value)}
            />
            <input type="time" aria-label="Abre" value={exAbre} disabled={exCerrado} onChange={(e) => setExAbre(e.target.value)} />
            <span className="horario-a">a</span>
            <input type="time" aria-label="Cierra" value={exCierra} disabled={exCerrado} onChange={(e) => setExCierra(e.target.value)} />
            <span className="horario-cerrado">
              <input type="checkbox" id="hc-ex" checked={exCerrado} onChange={(e) => setExCerrado(e.target.checked)} />
              <label htmlFor="hc-ex">Cerrar todo el día</label>
            </span>
          </div>
          <div className="horario-acciones">
            <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={aplicarCambioPuntual}>
              Aplicar cambio
            </button>
            <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={cerrarAhora}>
              🔒 Cerrar la tienda ahora
            </button>
          </div>

          {excepciones.length > 0 && (
            <>
              <h3 className="horario-titulo">Cambios programados</h3>
              <ul className="horario-lista">
                {excepciones.map((x) => (
                  <li key={x.fecha}>
                    <span>
                      <strong>{fechaLinda(x.fecha)}</strong> ·{' '}
                      {x.cerrado ? 'cerrado todo el día' : `${sinCero(x.abre ?? '')} a ${sinCero(x.cierra ?? '')}`}
                      {x.fecha === hoy && ' (hoy)'}
                    </span>
                    <button type="button" className="btn-link" disabled={busy} onClick={() => quitarCambio(x.fecha)}>
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {error && <p className="error-text">{error}</p>}
      {aviso && <p className="horario-ok">{aviso}</p>}
    </section>
  )
}
