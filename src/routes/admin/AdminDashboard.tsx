import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Attendance, Profile } from '../../types'
import { Logo } from '../../components/Logo'
import { downloadMonthlyHoursPdf } from '../../lib/monthlyReport'
import { groupByWorkerAndDay } from '../../lib/dailyGroups'
import { formatTime } from '../../lib/hours'

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

interface AdminDashboardProps {
  profile: Profile
}

interface AttendanceRow extends Attendance {
  ingreso_profiles: { full_name: string } | null
}

const TYPE_LABELS: Record<Attendance['type'], string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ingreso_colacion: 'Ingreso colación',
  salida_colacion: 'Salida colación',
}

export function AdminDashboard({ profile }: AdminDashboardProps) {
  const [workers, setWorkers] = useState<Profile[]>([])
  const [records, setRecords] = useState<AttendanceRow[]>([])
  const [filterWorker, setFilterWorker] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'day' | 'event'>('day')
  const [formOpen, setFormOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [createdRut, setCreatedRut] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [formBusy, setFormBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [reportWorker, setReportWorker] = useState<string>('')
  const [reportMonth, setReportMonth] = useState<string>(currentMonthValue())
  const [reportBusy, setReportBusy] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)

  const loadWorkers = useCallback(async () => {
    const { data } = await supabase
      .from('ingreso_profiles')
      .select('*')
      .eq('role', 'worker')
      .order('full_name')
    setWorkers((data as Profile[]) ?? [])
  }, [])

  const loadRecords = useCallback(async () => {
    let query = supabase
      .from('ingreso_attendance')
      .select('*, ingreso_profiles(full_name)')
      .order('recorded_at', { ascending: false })
      .limit(200)

    if (filterWorker !== 'all') {
      query = query.eq('worker_id', filterWorker)
    }

    const { data } = await query
    setRecords((data as unknown as AttendanceRow[]) ?? [])
  }, [filterWorker])

  useEffect(() => {
    loadWorkers()
  }, [loadWorkers])

  useEffect(() => {
    if (!reportWorker && workers.length > 0) {
      setReportWorker(workers[0].id)
    }
  }, [workers, reportWorker])

  useEffect(() => {
    const channel = supabase
      .channel('ingreso_attendance_admin')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingreso_attendance' },
        () => {
          loadRecords()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadRecords])

  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  async function handleCreateWorker(e: React.FormEvent) {
    e.preventDefault()
    setFormBusy(true)
    setFormError(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingreso-crear-trabajador`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ password, full_name: fullName }),
        },
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Error creando trabajador')

      setCreatedRut(body.rut)
      setFullName('')
      setPassword('')
      await loadWorkers()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error creando trabajador')
    } finally {
      setFormBusy(false)
    }
  }

  async function verFoto(path: string) {
    const { data, error } = await supabase.storage
      .from('ingreso-fotos')
      .createSignedUrl(path, 60)
    if (error || !data) return
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  function startEditing(w: Profile) {
    setEditingId(w.id)
    setEditingName(w.full_name)
    setEditError(null)
  }

  function cancelEditing() {
    setEditingId(null)
    setEditingName('')
    setEditError(null)
  }

  async function saveEditingName(id: string) {
    const trimmed = editingName.trim()
    if (!trimmed) return
    setEditError(null)
    const { error } = await supabase
      .from('ingreso_profiles')
      .update({ full_name: trimmed })
      .eq('id', id)
    if (error) {
      setEditError(error.message)
      return
    }
    setEditingId(null)
    await loadWorkers()
    await loadRecords()
  }

  const dailyGroups = useMemo(() => groupByWorkerAndDay(records), [records])

  async function handleDownloadReport() {
    if (!reportWorker) return
    const worker = workers.find((w) => w.id === reportWorker)
    if (!worker) return
    setReportBusy(true)
    setReportError(null)
    try {
      await downloadMonthlyHoursPdf(worker.id, worker.full_name, reportMonth)
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Error generando el PDF')
    } finally {
      setReportBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="brand-row">
          <Logo size={48} />
          <div>
            <h1>Panel de administración</h1>
            <p className="subtitle">Hola, {profile.full_name} (Administrador)</p>
          </div>
        </div>
        <button className="btn btn-secondary" onClick={() => supabase.auth.signOut()}>
          Cerrar sesión
        </button>
      </header>

      <section className="card">
        <div className="section-header">
          <h2>Trabajadores ({workers.length})</h2>
          <button className="btn btn-primary" onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? 'Cancelar' : 'Nuevo trabajador'}
          </button>
        </div>

        {formOpen && (
          <form onSubmit={handleCreateWorker} className="worker-form">
            <label>
              Nombre completo
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </label>
            <label>
              Contraseña
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </label>
            {formError && <p className="error-text">{formError}</p>}
            <button type="submit" className="btn btn-primary" disabled={formBusy}>
              {formBusy ? 'Creando...' : 'Crear trabajador'}
            </button>
          </form>
        )}

        {createdRut && (
          <p className="info-text">
            Trabajador creado. Ya aparece en la pantalla de inicio de sesión por su nombre.
          </p>
        )}

        <ul className="worker-list">
          {workers.map((w) => (
            <li key={w.id} className="worker-list-item">
              {editingId === w.id ? (
                <>
                  <input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    autoFocus
                  />
                  <button className="btn-link" onClick={() => saveEditingName(w.id)}>
                    Guardar
                  </button>
                  <button className="btn-link" onClick={cancelEditing}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span>{w.full_name}</span>
                  <button className="btn-link" onClick={() => startEditing(w)}>
                    Editar
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {editError && <p className="error-text">{editError}</p>}
      </section>

      <section className="card">
        <h2>Reporte mensual de horas</h2>
        <p className="subtitle">Descarga en PDF las horas trabajadas de un trabajador, día por día.</p>
        <div className="report-row">
          <label>
            Trabajador
            <select value={reportWorker} onChange={(e) => setReportWorker(e.target.value)}>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mes
            <input
              type="month"
              value={reportMonth}
              onChange={(e) => setReportMonth(e.target.value)}
            />
          </label>
          <button
            className="btn btn-primary"
            onClick={handleDownloadReport}
            disabled={reportBusy || !reportWorker}
          >
            {reportBusy ? 'Generando...' : 'Descargar PDF'}
          </button>
        </div>
        {reportError && <p className="error-text">{reportError}</p>}
      </section>

      <section className="card">
        <div className="section-header">
          <h2>Registros de entrada y salida</h2>
          <div className="table-controls">
            <select value={filterWorker} onChange={(e) => setFilterWorker(e.target.value)}>
              <option value="all">Todos los trabajadores</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name}
                </option>
              ))}
            </select>
            <select value={viewMode} onChange={(e) => setViewMode(e.target.value as 'day' | 'event')}>
              <option value="day">Vista por día</option>
              <option value="event">Vista por movimiento</option>
            </select>
          </div>
        </div>

        {viewMode === 'day' ? (
          <table className="table">
            <thead>
              <tr>
                <th>Trabajador</th>
                <th>Fecha</th>
                <th>Entrada</th>
                <th>Ingreso colación</th>
                <th>Salida colación</th>
                <th>Salida</th>
                <th>Foto</th>
              </tr>
            </thead>
            <tbody>
              {dailyGroups.map((g) => (
                <tr key={g.key}>
                  <td>{g.workerName}</td>
                  <td>{g.dateLabel}</td>
                  <td>{formatTime(g.entrada ? new Date(g.entrada.recorded_at) : null)}</td>
                  <td>
                    {formatTime(g.ingresoColacion ? new Date(g.ingresoColacion.recorded_at) : null)}
                  </td>
                  <td>
                    {formatTime(g.salidaColacion ? new Date(g.salidaColacion.recorded_at) : null)}
                  </td>
                  <td>{formatTime(g.salida ? new Date(g.salida.recorded_at) : null)}</td>
                  <td>
                    {g.entrada?.photo_path ? (
                      <button
                        className="btn-link"
                        onClick={() => verFoto(g.entrada!.photo_path as string)}
                      >
                        Ver foto
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Trabajador</th>
                <th>Tipo</th>
                <th>Fecha y hora</th>
                <th>Foto</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>{r.ingreso_profiles?.full_name ?? '—'}</td>
                  <td>{TYPE_LABELS[r.type]}</td>
                  <td>{new Date(r.recorded_at).toLocaleString()}</td>
                  <td>
                    {r.photo_path ? (
                      <button className="btn-link" onClick={() => verFoto(r.photo_path as string)}>
                        Ver foto
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
