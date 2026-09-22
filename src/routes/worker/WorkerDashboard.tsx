import { Fragment, useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Attendance, Profile } from '../../types'
import { CameraCapture } from '../../components/CameraCapture'
import { Logo } from '../../components/Logo'

interface WorkerDashboardProps {
  profile: Profile
}

const TYPE_LABELS: Record<Attendance['type'], string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ingreso_colacion: 'Ingreso colación',
  salida_colacion: 'Salida colación',
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
  const canRegisterIngresoColacion = lastRecord?.type === 'entrada'
  const canRegisterSalidaColacion = lastRecord?.type === 'ingreso_colacion'
  const canRegisterSalida =
    lastRecord?.type === 'entrada' || lastRecord?.type === 'salida_colacion'

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

  async function registrarSimple(type: 'salida' | 'ingreso_colacion' | 'salida_colacion') {
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await supabase.from('ingreso_attendance').insert({
        worker_id: profile.id,
        type,
      })
      if (error) throw error
      setMessage(`${TYPE_LABELS[type]} registrada correctamente.`)
      await loadRecords()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Error registrando el movimiento.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="brand-row">
          <Logo size={48} />
          <div>
            <h1>Hola, {profile.full_name}</h1>
            <p className="subtitle">Registra tu entrada, colación o salida</p>
          </div>
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
          className="btn btn-secondary"
          disabled={!canRegisterIngresoColacion || busy}
          onClick={() => registrarSimple('ingreso_colacion')}
        >
          Ingreso colación
        </button>
        <button
          className="btn btn-secondary"
          disabled={!canRegisterSalidaColacion || busy}
          onClick={() => registrarSimple('salida_colacion')}
        >
          Salida colación
        </button>
        <button
          className="btn btn-danger"
          disabled={!canRegisterSalida || busy}
          onClick={() => registrarSimple('salida')}
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
            <th>Hora</th>
            <th>Foto</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => {
            const dateLabel = new Date(r.recorded_at).toLocaleDateString('es-CL', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })
            const prevDateLabel =
              i > 0
                ? new Date(records[i - 1].recorded_at).toLocaleDateString('es-CL', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })
                : null
            const showDayHeader = dateLabel !== prevDateLabel

            return (
              <Fragment key={r.id}>
                {showDayHeader && (
                  <tr className="day-header-row">
                    <td colSpan={3}>{dateLabel}</td>
                  </tr>
                )}
                <tr>
                  <td>{TYPE_LABELS[r.type]}</td>
                  <td>
                    {new Date(r.recorded_at).toLocaleTimeString('es-CL', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td>{r.photo_path ? 'Sí' : '—'}</td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
