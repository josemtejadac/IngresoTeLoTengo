import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadNameDirectory } from '../lib/directory'
import {
  crearReporteLimpieza,
  crearTareaLimpieza,
  eliminarReporteLimpieza,
  eliminarTareaLimpieza,
  fotosLimpiezaUrls,
  loadReportesLimpieza,
  loadTareasLimpieza,
  type TareaLimpieza,
  type ReporteLimpieza as Reporte,
} from '../lib/limpieza'

interface Props {
  workerId: string
  isAdmin?: boolean
}

export function ReporteLimpieza({ workerId, isAdmin = false }: Props) {
  const [reportes, setReportes] = useState<Reporte[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [nota, setNota] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tareas, setTareas] = useState<TareaLimpieza[]>([])
  const [tareaActiva, setTareaActiva] = useState<TareaLimpieza | null>(null)
  const [nuevaTarea, setNuevaTarea] = useState('')
  const [verFoto, setVerFoto] = useState<string | null>(null)
  const busyRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const rows = await loadReportesLimpieza()
      setReportes(rows)
      setTareas(await loadTareasLimpieza())
      setUrls(await fotosLimpiezaUrls(rows.map((r) => r.foto_path)))
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingreso_reportes_limpieza' },
        () => {
          load()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingreso_tareas_limpieza' },
        () => {
          load()
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busyRef.current) return
    if (!file || !nota.trim()) {
      setError('Agrega una foto y una nota (ej: limpieza nevera).')
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await crearReporteLimpieza(workerId, file, nota, tareaActiva?.id ?? null)
      setTareaActiva(null)
      setNota('')
      setFile(null)
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

  return (
    <section className="card">
      <h2>Reporte de limpieza</h2>
      <p className="subtitle">
        Sube una foto de lo que limpiaste y escribe qué fue. Los reportes se borran solos a los 10 días. Lo ven todos los trabajadores y el
        administrador.
      </p>

      {isAdmin && (
        <form onSubmit={handleCrearTarea} className="report-row">
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
        <>
          <h3>Solicitudes de limpieza pendientes</h3>
          {pendientes.map((t) => (
            <div key={t.id} className="deuda-cliente">
              <div className="deuda-cliente-head">
                <div>
                  <strong>{t.titulo}</strong>
                  <p className="subtitle">
                    Pedido el {new Date(t.created_at).toLocaleDateString('es-CL')}
                  </p>
                </div>
                <div className="table-controls">
                  <button className="btn btn-primary btn-small" onClick={() => empezarTarea(t)}>
                    Yo la hago
                  </button>
                  {isAdmin && (
                    <button
                      className="btn btn-danger btn-small"
                      onClick={() => handleEliminarTarea(t)}
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
      {hechas.length > 0 && (
        <p className="subtitle">
          Completadas:{' '}
          {hechas
            .map((t) => `${t.titulo} (${names[t.completada_por ?? ''] ?? '—'})`)
            .join(' · ')}
        </p>
      )}

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

      <form onSubmit={handleSubmit} className="worker-form">
        <label>
          Foto (se comprime sola)
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Nota
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={200}
            placeholder="Ej: limpieza nevera"
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Subiendo...' : 'Subir reporte'}
        </button>
      </form>

      {reportes.length === 0 && <p className="subtitle">Todavía no hay reportes.</p>}
      <div className="tienda-grid">
        {reportes.map((r) => (
          <div key={r.id} className="tienda-card">
            {urls[r.foto_path] ? (
              <img
                src={urls[r.foto_path]}
                alt={r.nota}
                className="tienda-foto"
                onClick={() => setVerFoto(urls[r.foto_path])}
              />
            ) : (
              <div className="tienda-foto tienda-foto-placeholder" />
            )}
            <p className="tienda-nombre">{r.nota}</p>
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
        ))}
      </div>

      {verFoto && (
        <div className="camera-overlay" onClick={() => setVerFoto(null)}>
          <div className="camera-modal">
            <img src={verFoto} alt="" style={{ width: '100%', borderRadius: 8 }} />
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
