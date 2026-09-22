import { Fragment, useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Attendance, Profile } from '../../types'
import { Logo } from '../../components/Logo'
import { downloadMonthlyHoursPdf } from '../../lib/monthlyReport'
import { formatCLP } from '../../lib/payroll'

const WEEKDAYS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
]

interface ScheduleForm {
  schedule_start: string
  schedule_end: string
  work_days: number[]
  pay_amount: string
  pay_frequency: 'weekly' | 'monthly'
  tuesday_bonus: string
}

function scheduleFormFromProfile(w: Profile): ScheduleForm {
  return {
    schedule_start: w.schedule_start?.slice(0, 5) ?? '09:00',
    schedule_end: w.schedule_end?.slice(0, 5) ?? '18:00',
    work_days: w.work_days ?? [],
    pay_amount: w.pay_amount?.toString() ?? '',
    pay_frequency: w.pay_frequency ?? 'monthly',
    tuesday_bonus: w.tuesday_bonus ? w.tuesday_bonus.toString() : '',
  }
}

function describeSchedule(w: Profile): string {
  if (!w.schedule_start || !w.schedule_end || !w.work_days || w.work_days.length === 0) {
    return 'Sin horario configurado'
  }
  const days = WEEKDAYS.filter((d) => w.work_days!.includes(d.value))
    .map((d) => d.label)
    .join(', ')
  const pay = w.pay_amount
    ? `${formatCLP(w.pay_amount)} ${w.pay_frequency === 'monthly' ? 'mensual' : 'semanal'}`
    : 'sin sueldo configurado'
  const bonus = w.tuesday_bonus > 0 ? ` · Bono martes ${formatCLP(w.tuesday_bonus)}` : ''
  return `${days} · ${w.schedule_start.slice(0, 5)}–${w.schedule_end.slice(0, 5)} · ${pay}${bonus}`
}

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function currentDateValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
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
  const [filterMode, setFilterMode] = useState<'day' | 'month'>('day')
  const [filterDate, setFilterDate] = useState<string>(currentDateValue())
  const [filterListMonth, setFilterListMonth] = useState<string>(currentMonthValue())
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
  const [scheduleEditingId, setScheduleEditingId] = useState<string | null>(null)
  const [scheduleForm, setScheduleForm] = useState<ScheduleForm | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleBusy, setScheduleBusy] = useState(false)

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
      .limit(500)

    if (filterWorker !== 'all') {
      query = query.eq('worker_id', filterWorker)
    }

    if (filterMode === 'day') {
      const [y, m, d] = filterDate.split('-').map(Number)
      const start = new Date(y, m - 1, d, 0, 0, 0)
      const end = new Date(y, m - 1, d + 1, 0, 0, 0)
      query = query.gte('recorded_at', start.toISOString()).lt('recorded_at', end.toISOString())
    } else {
      const [y, m] = filterListMonth.split('-').map(Number)
      const start = new Date(y, m - 1, 1, 0, 0, 0)
      const end = new Date(y, m, 1, 0, 0, 0)
      query = query.gte('recorded_at', start.toISOString()).lt('recorded_at', end.toISOString())
    }

    const { data } = await query
    setRecords((data as unknown as AttendanceRow[]) ?? [])
  }, [filterWorker, filterMode, filterDate, filterListMonth])

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

  function startScheduleEdit(w: Profile) {
    setScheduleEditingId(w.id)
    setScheduleForm(scheduleFormFromProfile(w))
    setScheduleError(null)
  }

  function cancelScheduleEdit() {
    setScheduleEditingId(null)
    setScheduleForm(null)
    setScheduleError(null)
  }

  function toggleScheduleDay(day: number) {
    setScheduleForm((f) =>
      f
        ? {
            ...f,
            work_days: f.work_days.includes(day)
              ? f.work_days.filter((d) => d !== day)
              : [...f.work_days, day],
          }
        : f,
    )
  }

  async function saveSchedule(id: string) {
    if (!scheduleForm) return
    setScheduleBusy(true)
    setScheduleError(null)
    const payAmount = Number(scheduleForm.pay_amount)
    const tuesdayBonus = scheduleForm.tuesday_bonus ? Number(scheduleForm.tuesday_bonus) : 0
    if (Number.isNaN(payAmount) || Number.isNaN(tuesdayBonus)) {
      setScheduleError('Los montos deben ser números')
      setScheduleBusy(false)
      return
    }
    const { error } = await supabase
      .from('ingreso_profiles')
      .update({
        schedule_start: scheduleForm.schedule_start,
        schedule_end: scheduleForm.schedule_end,
        work_days: scheduleForm.work_days,
        pay_amount: payAmount,
        pay_frequency: scheduleForm.pay_frequency,
        tuesday_bonus: tuesdayBonus,
      })
      .eq('id', id)
    setScheduleBusy(false)
    if (error) {
      setScheduleError(error.message)
      return
    }
    setScheduleEditingId(null)
    setScheduleForm(null)
    await loadWorkers()
  }

  async function handleDownloadReport() {
    if (!reportWorker) return
    const worker = workers.find((w) => w.id === reportWorker)
    if (!worker) return
    setReportBusy(true)
    setReportError(null)
    try {
      await downloadMonthlyHoursPdf(worker, reportMonth)
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
        <h2>Horarios y sueldos</h2>
        <p className="subtitle">
          Configura el horario habitual, el sueldo base y las horas extra de cada trabajador.
        </p>
        <ul className="worker-list">
          {workers.map((w) => (
            <li key={w.id} className="schedule-item">
              {scheduleEditingId === w.id && scheduleForm ? (
                <div className="schedule-form">
                  <strong>{w.full_name}</strong>
                  <div className="schedule-days">
                    {WEEKDAYS.map((d) => (
                      <label key={d.value} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={scheduleForm.work_days.includes(d.value)}
                          onChange={() => toggleScheduleDay(d.value)}
                        />
                        {d.label}
                      </label>
                    ))}
                  </div>
                  <div className="report-row">
                    <label>
                      Entrada
                      <input
                        type="time"
                        value={scheduleForm.schedule_start}
                        onChange={(e) =>
                          setScheduleForm((f) => f && { ...f, schedule_start: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Salida
                      <input
                        type="time"
                        value={scheduleForm.schedule_end}
                        onChange={(e) =>
                          setScheduleForm((f) => f && { ...f, schedule_end: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="report-row">
                    <label>
                      Sueldo base
                      <input
                        type="number"
                        min={0}
                        value={scheduleForm.pay_amount}
                        onChange={(e) =>
                          setScheduleForm((f) => f && { ...f, pay_amount: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Frecuencia
                      <select
                        value={scheduleForm.pay_frequency}
                        onChange={(e) =>
                          setScheduleForm(
                            (f) => f && { ...f, pay_frequency: e.target.value as 'weekly' | 'monthly' },
                          )
                        }
                      >
                        <option value="monthly">Mensual</option>
                        <option value="weekly">Semanal</option>
                      </select>
                    </label>
                    <label>
                      Bono martes
                      <input
                        type="number"
                        min={0}
                        value={scheduleForm.tuesday_bonus}
                        onChange={(e) =>
                          setScheduleForm((f) => f && { ...f, tuesday_bonus: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  {scheduleError && <p className="error-text">{scheduleError}</p>}
                  <div className="report-row">
                    <button
                      className="btn btn-primary"
                      onClick={() => saveSchedule(w.id)}
                      disabled={scheduleBusy}
                    >
                      {scheduleBusy ? 'Guardando...' : 'Guardar'}
                    </button>
                    <button className="btn btn-secondary" onClick={cancelScheduleEdit}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <strong>{w.full_name}</strong>
                    <p className="subtitle">{describeSchedule(w)}</p>
                  </div>
                  <button className="btn-link" onClick={() => startScheduleEdit(w)}>
                    Editar
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
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
            <select value={filterMode} onChange={(e) => setFilterMode(e.target.value as 'day' | 'month')}>
              <option value="day">Por día</option>
              <option value="month">Por mes</option>
            </select>
            {filterMode === 'day' ? (
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
            ) : (
              <input
                type="month"
                value={filterListMonth}
                onChange={(e) => setFilterListMonth(e.target.value)}
              />
            )}
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Trabajador</th>
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
                    <tr key={`${dateLabel}-header`} className="day-header-row">
                      <td colSpan={4}>{dateLabel}</td>
                    </tr>
                  )}
                  <tr>
                    <td>{r.ingreso_profiles?.full_name ?? '—'}</td>
                    <td>{TYPE_LABELS[r.type]}</td>
                    <td>{new Date(r.recorded_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</td>
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
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}
