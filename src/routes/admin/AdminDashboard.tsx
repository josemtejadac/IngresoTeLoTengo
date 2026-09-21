import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Attendance, Profile } from '../../types'

interface AdminDashboardProps {
  profile: Profile
}

interface AttendanceRow extends Attendance {
  ingreso_profiles: { full_name: string } | null
}

export function AdminDashboard({ profile }: AdminDashboardProps) {
  const [workers, setWorkers] = useState<Profile[]>([])
  const [records, setRecords] = useState<AttendanceRow[]>([])
  const [filterWorker, setFilterWorker] = useState<string>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [createdRut, setCreatedRut] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [formBusy, setFormBusy] = useState(false)

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

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Panel de administración</h1>
          <p className="subtitle">Hola, {profile.full_name}</p>
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
            <li key={w.id}>{w.full_name}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="section-header">
          <h2>Registros de entrada y salida</h2>
          <select value={filterWorker} onChange={(e) => setFilterWorker(e.target.value)}>
            <option value="all">Todos los trabajadores</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name}
              </option>
            ))}
          </select>
        </div>

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
                <td>{r.type === 'entrada' ? 'Entrada' : 'Salida'}</td>
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
      </section>
    </div>
  )
}
