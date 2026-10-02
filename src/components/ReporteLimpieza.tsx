import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadNameDirectory } from '../lib/directory'
import { CameraCapture } from './CameraCapture'
import { plantillaDelMes, tareaDelDia } from '../lib/planificadorLimpieza'
import {
  crearReporteLimpieza,
  crearTareaLimpieza,
  eliminarReporteLimpieza,
  eliminarTareaLimpieza,
  fotosLimpiezaUrls,
  loadReportesLimpieza,
  loadTareasLimpieza,
  MAX_FOTOS_LIMPIEZA,
  type TareaLimpieza,
  type TipoReporteLimpieza,
  type ReporteLimpieza as Reporte,
} from '../lib/limpieza'

interface Props {
  workerId: string
  isAdmin?: boolean
}

interface FotoPendiente {
  id: string
  blob: File | Blob
  previewUrl: string
}

export function ReporteLimpieza({ workerId, isAdmin = false }: Props) {
  const [reportes, setReportes] = useState<Reporte[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [tipo, setTipo] = useState<TipoReporteLimpieza>('limpieza')
  const [nota, setNota] = useState('')
  const [fotos, setFotos] = useState<FotoPendiente[]>([])
  const [camaraAbierta, setCamaraAbierta] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tareas, setTareas] = useState<TareaLimpieza[]>([])
  const [tareaActiva, setTareaActiva] = useState<TareaLimpieza | null>(null)
  const [nuevaTarea, setNuevaTarea] = useState('')
  const [verFoto, setVerFoto] = useState<{ nombre: string; urls: string[]; indice: number } | null>(null)
  const [verCalendario, setVerCalendario] = useState(false)
  const busyRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hoy = new Date()
  const tareaHoy = tareaDelDia(hoy)
  const { nombre: mesPlantilla, tareas: tareasDelMes } = plantillaDelMes(hoy)

  const load = useCallback(async () => {
    try {
      const rows = await loadReportesLimpieza()
      setReportes(rows)
      setTareas(await loadTareasLimpieza())
      setUrls(await fotosLimpiezaUrls(rows.flatMap((r) => (r.foto_paths?.length > 0 ? r.foto_paths : [r.foto_path]))))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando los reportes')
    }
  }, [])

  useEffect(() => {
    load()
    loadNameDirectory().then(setNames).catch(() => {})
  }, [load])

  useEffect(() => {
    const channel = supabase
      .channel('ingreso_reportes_limpieza')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingreso_reportes_limpieza' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingreso_tareas_limpieza' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  // Las URLs de previsualización se liberan solas al desmontar o reemplazar.
  useEffect(() => {
    return () => {
      fotos.forEach((f) => URL.revokeObjectURL(f.previewUrl))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function agregarFoto(blob: File | Blob) {
    setFotos((prev) => {
      if (prev.length >= MAX_FOTOS_LIMPIEZA) return prev
      return [...prev, { id: `${Date.now()}-${Math.random()}`, blob, previewUrl: URL.createObjectURL(blob) }]
    })
    setError(null)
  }

  function quitarFoto(id: string) {
    setFotos((prev) => {
      const item = prev.find((f) => f.id === id)
      if (item) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((f) => f.id !== id)
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busyRef.current) return
    if (!nota.trim() || (tipo === 'limpieza' && fotos.length === 0)) {
      setError(
        tipo === 'limpieza'
          ? 'Agrega al menos una foto y una nota (ej: limpieza nevera).'
          : 'Agrega una nota (la foto es opcional en una observación).',
      )
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await crearReporteLimpieza(
        workerId,
        fotos.map((f) => f.blob),
        nota,
        tareaActiva?.id ?? null,
        tipo,
      )
      setTareaActiva(null)
      setNota('')
      setTipo('limpieza')
      fotos.forEach((f) => URL.revokeObjectURL(f.previewUrl))
      setFotos([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error subiendo el reporte')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function handleCrearTarea(e: React.FormEvent) {
    e.preventDefault()
    if (!nuevaTarea.trim() || busyRef.current) return
    busyRef.current = true
    setError(null)
    try {
      await crearTareaLimpieza(workerId, nuevaTarea)
      setNuevaTarea('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando la solicitud')
    } finally {
      busyRef.current = false
    }
  }

  async function handleEliminarTarea(t: TareaLimpieza) {
    if (!window.confirm(`¿Eliminar la solicitud "${t.titulo}"?`)) return
    try {
      await eliminarTareaLimpieza(t.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error eliminando la solicitud')
    }
  }

  function empezarTarea(t: TareaLimpieza) {
    setTareaActiva(t)
    setNota(t.titulo)
    setError(null)
  }

  function empezarTareaDelDia() {
    if (!tareaHoy) return
    setTareaActiva(null)
    setTipo('limpieza')
    setNota(`${tareaHoy.tarea} (${tareaHoy.trabajador})`)
    setError(null)
  }

  const pendientes = tareas.filter((t) => !t.completada_at)
  const hechas = tareas.filter((t) => t.completada_at).slice(0, 5)

  async function handleEliminar(r: Reporte) {
    if (!window.confirm('¿Eliminar este reporte de limpieza?')) return
    try {
      await eliminarReporteLimpieza(r)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error eliminando el reporte')
    }
  }

  function fotosDe(r: Reporte): string[] {
    const paths = r.foto_paths?.length > 0 ? r.foto_paths : [r.foto_path]
    return paths.map((p) => urls[p]).filter((u): u is string => !!u)
  }

  return (
    <section className="card">
      <h2>🧹 Limpieza y observaciones</h2>
      <p className="subtitle">
        Registra una limpieza (con foto) o deja una observación (solo nota, sin foto obligatoria). Los reportes se
        borran solos a los 60 días. Lo ven todos los trabajadores y el administrador.
      </p>

      <div className="limpieza-bloque limpieza-planificador">
        {tareaHoy ? (
          <div className="deuda-cliente">
            <div className="deuda-cliente-head">
              <div>
                <strong>📅 Hoy toca: {tareaHoy.tarea}</strong>
                <p className="subtitle">Asignado a {tareaHoy.trabajador} — pero cualquiera puede subirlo si hace falta.</p>
              </div>
              <button type="button" className="btn btn-primary btn-small" onClick={empezarTareaDelDia}>
                La hago yo
              </button>
            </div>
          </div>
        ) : (
          <p className="subtitle">📅 Hoy no hay nada agendado en el calendario de limpieza.</p>
        )}
        <button type="button" className="btn-link-sutil" onClick={() => setVerCalendario((v) => !v)}>
          {verCalendario ? '▲ Ocultar calendario del mes' : `▾ Ver calendario completo (plantilla de ${mesPlantilla})`}
        </button>
        {verCalendario && (
          <div className="limpieza-calendario">
            {tareasDelMes.map((t) => (
              <div key={t.dia} className="limpieza-calendario-fila">
                <span className="limpieza-calendario-dia">Día {t.dia}</span>
                <span>{t.tarea}</span>
                <span className="subtitle">{t.trabajador}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {isAdmin && (
        <form onSubmit={handleCrearTarea} className="report-row limpieza-form-tarea">
          <label className="chat-input">
            Nueva solicitud para los trabajadores
            <input
              value={nuevaTarea}
              onChange={(e) => setNuevaTarea(e.target.value)}
              maxLength={200}
              placeholder="Ej: por favor limpiar la cortadora"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!nuevaTarea.trim()}>
            Crear solicitud
          </button>
        </form>
      )}

      {pendientes.length > 0 && (
        <div className="limpieza-bloque">
          <h3>📋 Solicitudes pendientes</h3>
          {pendientes.map((t) => (
            <div key={t.id} className="deuda-cliente">
              <div className="deuda-cliente-head">
                <div>
                  <strong>{t.titulo}</strong>
                  <p className="subtitle">Pedido el {new Date(t.created_at).toLocaleDateString('es-CL')}</p>
                </div>
                <div className="table-controls">
                  <button className="btn btn-primary btn-small" onClick={() => empezarTarea(t)}>
                    Yo la hago
                  </button>
                  {isAdmin && (
                    <button className="btn btn-danger btn-small" onClick={() => handleEliminarTarea(t)}>
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {hechas.length > 0 && (
        <p className="subtitle">
          Completadas: {hechas.map((t) => `${t.titulo} (${names[t.completada_por ?? ''] ?? '—'})`).join(' · ')}
        </p>
      )}

      <div className="limpieza-bloque">
        {tareaActiva && (
          <p className="info-text">
            Completando: <strong>{tareaActiva.titulo}</strong> — sube la foto y guarda.{' '}
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setTareaActiva(null)
                setNota('')
              }}
            >
              Cancelar
            </button>
          </p>
        )}

        <form onSubmit={handleSubmit} className="worker-form limpieza-form">
          <div className="limpieza-tipo-tabs">
            <button
              type="button"
              className={tipo === 'limpieza' ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}
              onClick={() => setTipo('limpieza')}
            >
              🧹 Limpieza
            </button>
            <button
              type="button"
              className={tipo === 'observacion' ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}
              onClick={() => setTipo('observacion')}
            >
              📝 Observación
            </button>
          </div>
          <p className="campo-etiqueta">
            Fotos ({fotos.length}/{MAX_FOTOS_LIMPIEZA}){tipo === 'observacion' ? ' — opcional' : ''}
          </p>
          <div className="limpieza-fotos-fila">
            {fotos.map((f) => (
              <div key={f.id} className="limpieza-foto-miniatura">
                <img src={f.previewUrl} alt="" />
                <button type="button" className="limpieza-foto-quitar" onClick={() => quitarFoto(f.id)} aria-label="Quitar foto">
                  ✕
                </button>
              </div>
            ))}
            {fotos.length < MAX_FOTOS_LIMPIEZA && (
              <div className="limpieza-foto-agregar">
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setCamaraAbierta(true)}>
                  📷 Tomar foto
                </button>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => fileInputRef.current?.click()}>
                  🖼️ Elegir de galería
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) agregarFoto(f)
                    e.target.value = ''
                  }}
                />
              </div>
            )}
          </div>
          <label>
            Nota
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={200}
              placeholder={tipo === 'limpieza' ? 'Ej: limpieza nevera' : 'Ej: se acabó el detergente'}
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Subiendo...' : 'Subir reporte'}
          </button>
        </form>
      </div>

      {camaraAbierta && (
        <CameraCapture
          onCapture={(blob) => {
            agregarFoto(blob)
            setCamaraAbierta(false)
          }}
          onCancel={() => setCamaraAbierta(false)}
        />
      )}

      <div className="limpieza-bloque">
        <h3>🗂️ Reportes</h3>
        {reportes.length === 0 && <p className="subtitle">Todavía no hay reportes.</p>}
        <div className="limpieza-grid">
          {reportes.map((r) => {
            const fotosR = fotosDe(r)
            return (
              <div key={r.id} className="limpieza-card">
                {fotosR.length > 0 ? (
                  <div className="limpieza-card-fotos">
                    {fotosR.map((u, i) => (
                      <img
                        key={i}
                        src={u}
                        alt={r.nota}
                        className="limpieza-card-foto"
                        onClick={() => setVerFoto({ nombre: r.nota, urls: fotosR, indice: i })}
                      />
                    ))}
                  </div>
                ) : (
                  <span className="limpieza-card-tipo-badge">
                    {r.tipo === 'observacion' ? '📝 Observación' : '🧹 Limpieza'}
                  </span>
                )}
                <p className="limpieza-card-nota">
                  {fotosR.length > 0 && (
                    <span className="limpieza-card-tipo-icono" title={r.tipo === 'observacion' ? 'Observación' : 'Limpieza'}>
                      {r.tipo === 'observacion' ? '📝' : '🧹'}
                    </span>
                  )}
                  {r.nota}
                </p>
                <p className="subtitle">
                  {names[r.worker_id] ?? '—'} ·{' '}
                  {new Date(r.created_at).toLocaleString('es-CL', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                {isAdmin && (
                  <button className="btn btn-danger btn-small" onClick={() => handleEliminar(r)}>
                    Eliminar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {verFoto && (
        <div className="camera-overlay" onClick={() => setVerFoto(null)}>
          <div className="camera-modal" onClick={(e) => e.stopPropagation()}>
            <img src={verFoto.urls[verFoto.indice]} alt="" style={{ width: '100%', borderRadius: 8 }} />
            {verFoto.urls.length > 1 && (
              <div className="limpieza-visor-miniaturas">
                {verFoto.urls.map((u, i) => (
                  <img
                    key={i}
                    src={u}
                    alt=""
                    className={i === verFoto.indice ? 'limpieza-visor-mini activa' : 'limpieza-visor-mini'}
                    onClick={() => setVerFoto({ ...verFoto, indice: i })}
                  />
                ))}
              </div>
            )}
            <div className="camera-actions">
              <button className="btn btn-secondary" onClick={() => setVerFoto(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
