import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Attendance, Profile } from '../../types'
import { CameraCapture } from '../../components/CameraCapture'

interface WorkerDashboardProps {
  profile: Profile
}

export function WorkerDashboard({ profile }: WorkerDashboardProps) {
  const [records, setRecords] = useState<Attendance[]>([])
  const [showCamera, setShowCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const loadRecords = useCallback(async () => {
    const { data } = await supabase
      .from('ingreso_attendance')
      .select('*')
      .eq('worker_id', profile.id)
      .order('recorded_at', { ascending: false })
      .limit(30)
    setRecords((data as Attendance[]) ?? [])
  }, [profile.id])

  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  useEffect(() => {
    const channel = supabase
      .channel(`ingreso_attendance_worker_${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ingreso_attendance',
          filter: `worker_id=eq.${profile.id}`,
        },
        () => {
          loadRecords()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadRecords, profile.id])

  const lastRecord = records[0]
  const canRegisterEntrada = !lastRecord || lastRecord.type === 'salida'
  const canRegisterSalida = !!lastRecord && lastRecord.type === 'entrada'

  async function registrarEntrada(photo: Blob) {
    setBusy(true)
    setMessage(null)
    try {
      const path = `${profile.id}/${Date.now()}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('ingreso-fotos')
        .upload(path, photo, { contentType: 'image/jpeg' })

      if (uploadError) throw uploadError

      const { error: insertError } = await supabase.from('ingreso_attendance').insert({
        worker_id: profile.id,
        type: 'entrada',
        photo_path: path,
      })

      if (insertError) throw insertError

      setMessage('Entrada registrada correctamente.')
      setShowCamera(false)
      await loadRecords()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Error registrando la entrada.')
    } finally {
      setBusy(false)
    }
  }

  async function registrarSalida() {
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await supabase.from('ingreso_attendance').insert({
        worker_id: profile.id,
        type: 'salida',
      })
      if (error) throw error
      setMessage('Salida registrada correctamente.')
      await loadRecords()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Error registrando la salida.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Hola, {profile.full_name}</h1>
          <p className="subtitle">Registra tu entrada o salida</p>
        </div>
        <button className="btn btn-secondary" onClick={() => supabase.auth.signOut()}>
          Cerrar sesión
        </button>
      </header>

      <div className="action-row">
        <button
          className="btn btn-primary"
          disabled={!canRegisterEntrada || busy}
          onClick={() => setShowCamera(true)}
        >
          Registrar entrada
        </button>
        <button
          className="btn btn-danger"
          disabled={!canRegisterSalida || busy}
          onClick={registrarSalida}
        >
          Registrar salida
        </button>
      </div>

      {message && <p className="info-text">{message}</p>}

      {showCamera && (
        <CameraCapture onCapture={registrarEntrada} onCancel={() => setShowCamera(false)} />
      )}

      <h2>Tu historial</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Fecha y hora</th>
            <th>Foto</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td>{r.type === 'entrada' ? 'Entrada' : 'Salida'}</td>
              <td>{new Date(r.recorded_at).toLocaleString()}</td>
              <td>{r.photo_path ? 'Sí' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
