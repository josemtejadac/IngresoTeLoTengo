import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Attendance, Profile } from '../../types'
import { CameraCapture } from '../../components/CameraCapture'
import { Logo } from '../../components/Logo'
import { ProductosScanner } from '../../components/ProductosScanner'
import { PendientesPorCliente } from '../../components/PendientesPorCliente'
import { ReporteLimpieza } from '../../components/ReporteLimpieza'
import { AsistenteTienda } from '../../components/AsistenteTienda'
import { PedidosTienda } from '../../components/PedidosTienda'
import { computeShifts, formatHoursMinutes } from '../../lib/hours'
import {
  annotateOvertime,
  computePaySummary,
  formatCLP,
  OVERTIME_RATE_PER_HOUR,
  type PaySummary,
} from '../../lib/payroll'
import {
  formatWeekLabel,
  getCurrentWeek,
  getWeeksEndingInMonth,
  isWeekEarned,
  loadWeeklyBonusForWorker,
  totalEarned,
  type WeeklyBonusRow,
} from '../../lib/weeklyBonus'
import {
  loadArqueoForWorkerDay,
  loadWeeklySalesTotal,
  submitArqueo,
  ventaTotal,
  WEEKLY_SALES_GOAL,
  type ArqueoEntry,
} from '../../lib/arqueo'
import {
  addPendientes,
  loadPendientes,
  markPendientesPagados,
  abonarPendientes,
  agruparPorCliente,
  totalPendiente,
  type PendienteEntry,
} from '../../lib/pendientes'
import { loadNameDirectory } from '../../lib/directory'
import {
  computeFeriadoBonus,
  loadFeriados,
  loadFeriadoExclusionsForWorker,
  type FeriadoSummary,
} from '../../lib/feriados'

interface WorkerDashboardProps {
  profile: Profile
}

const TYPE_LABELS: Record<Attendance['type'], string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ingreso_colacion: 'Ingreso colación',
  salida_colacion: 'Salida colación',
}

function currentDateValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function WorkerDashboard({ profile }: WorkerDashboardProps) {
  const [records, setRecords] = useState<Attendance[]>([])
  const [lastRecord, setLastRecord] = useState<Attendance | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [cameraAction, setCameraAction] = useState<'entrada' | 'salida' | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [filterMode, setFilterMode] = useState<'day' | 'month'>('day')
  const [filterDate, setFilterDate] = useState<string>(currentDateValue())
  const [filterMonth, setFilterMonth] = useState<string>(currentMonthValue())
  const [paySummary, setPaySummary] = useState<PaySummary | null>(null)
  const [feriadoSummary, setFeriadoSummary] = useState<FeriadoSummary | null>(null)
  const [weeklyBonusRows, setWeeklyBonusRows] = useState<WeeklyBonusRow[]>([])
  const [todayArqueo, setTodayArqueo] = useState<ArqueoEntry[]>([])
  const [weeklySales, setWeeklySales] = useState<number>(0)
  const [efectivo, setEfectivo] = useState('')
  const [debito, setDebito] = useState('')
  const [credito, setCredito] = useState('')
  const [transferencia, setTransferencia] = useState('')
  const [arqueoBusy, setArqueoBusy] = useState(false)
  const [arqueoMessage, setArqueoMessage] = useState<string | null>(null)
  const [arqueoError, setArqueoError] = useState<string | null>(null)
  const [pendientes, setPendientes] = useState<PendienteEntry[]>([])
  const [nameDirectory, setNameDirectory] = useState<Record<string, string>>({})
  const pendienteBusyRef = useRef(false)
  const [pendienteRows, setPendienteRows] = useState([{ cliente: '', detalle: '', monto: '' }])
  const [pendienteBusy, setPendienteBusy] = useState(false)
  const [pendienteError, setPendienteError] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<
    'inicio' | 'productos' | 'pedidos' | 'arqueo' | 'pendientes' | 'limpieza' | 'historial'
  >('inicio')

  const loadRecords = useCallback(async () => {
    let query = supabase
      .from('ingreso_attendance')
      .select('*')
      .eq('worker_id', profile.id)
      .order('recorded_at', { ascending: false })
      .limit(500)

    if (filterMode === 'day') {
      const [y, m, d] = filterDate.split('-').map(Number)
      const start = new Date(y, m - 1, d, 0, 0, 0)
      const end = new Date(y, m - 1, d + 1, 0, 0, 0)
      query = query.gte('recorded_at', start.toISOString()).lt('recorded_at', end.toISOString())
    } else {
      const [y, m] = filterMonth.split('-').map(Number)
      const start = new Date(y, m - 1, 1, 0, 0, 0)
      const end = new Date(y, m, 1, 0, 0, 0)
      query = query.gte('recorded_at', start.toISOString()).lt('recorded_at', end.toISOString())
    }

    const { data } = await query
    setRecords((data as Attendance[]) ?? [])
  }, [profile.id, filterMode, filterDate, filterMonth])

  const loadLastRecord = useCallback(async () => {
    const { data } = await supabase
      .from('ingreso_attendance')
      .select('*')
      .eq('worker_id', profile.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setLastRecord((data as Attendance | null) ?? null)
  }, [profile.id])

  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  useEffect(() => {
    loadLastRecord()
  }, [loadLastRecord])

  const loadPaySummary = useCallback(async () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0)

    const { data } = await supabase
      .from('ingreso_attendance')
      .select('*')
      .eq('worker_id', profile.id)
      .gte('recorded_at', start.toISOString())
      .lt('recorded_at', end.toISOString())
      .order('recorded_at', { ascending: true })

    const shifts = annotateOvertime(computeShifts((data as Attendance[]) ?? []), profile)
    setPaySummary(computePaySummary(shifts, profile, start, end))

    const feriados = await loadFeriados()
    const exclusions = await loadFeriadoExclusionsForWorker(profile.id)
    const excludedDates = new Set(exclusions.map((e) => e.fecha))
    setFeriadoSummary(computeFeriadoBonus(shifts, feriados, excludedDates))
  }, [profile])

  useEffect(() => {
    loadPaySummary()
  }, [loadPaySummary])

  const loadBonusRows = useCallback(async () => {
    const rows = await loadWeeklyBonusForWorker(profile.id, currentMonthValue())
    setWeeklyBonusRows(rows)
  }, [profile.id])

  useEffect(() => {
    loadBonusRows()
  }, [loadBonusRows])

  const loadTodayArqueo = useCallback(async () => {
    const rows = await loadArqueoForWorkerDay(profile.id, currentDateValue())
    setTodayArqueo(rows)
  }, [profile.id])

  const loadWeeklySales = useCallback(async () => {
    const total = await loadWeeklySalesTotal(getCurrentWeek())
    setWeeklySales(total)
  }, [])

  const loadPendientesRows = useCallback(async () => {
    const rows = await loadPendientes()
    setPendientes(rows)
  }, [])

  const loadDirectory = useCallback(async () => {
    const map = await loadNameDirectory()
    setNameDirectory(map)
  }, [])

  useEffect(() => {
    loadTodayArqueo()
    loadWeeklySales()
    loadPendientesRows()
    loadDirectory()
  }, [loadTodayArqueo, loadWeeklySales, loadPendientesRows, loadDirectory])

  useEffect(() => {
    const channel = supabase
      .channel('ingreso_arqueo_all')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingreso_arqueo' },
        () => {
          loadWeeklySales()
          loadTodayArqueo()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingreso_pendientes' },
        () => {
          loadPendientesRows()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadWeeklySales, loadTodayArqueo, loadPendientesRows])

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
          loadLastRecord()
          loadPaySummary()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ingreso_weekly_bonus',
          filter: `worker_id=eq.${profile.id}`,
        },
        () => {
          loadBonusRows()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadRecords, loadLastRecord, loadPaySummary, loadBonusRows, profile.id])

  const refreshAll = useCallback(() => {
    loadRecords()
    loadLastRecord()
    loadPaySummary()
    loadBonusRows()
    loadTodayArqueo()
    loadWeeklySales()
    loadPendientesRows()
    loadDirectory()
  }, [
    loadRecords,
    loadLastRecord,
    loadPaySummary,
    loadBonusRows,
    loadTodayArqueo,
    loadWeeklySales,
    loadPendientesRows,
    loadDirectory,
  ])

  // El celular corta el WebSocket de tiempo real cuando la pantalla se
  // bloquea o la app pasa a segundo plano. Al volver, refrescamos todo a
  // mano para no depender solo de la conexion en vivo.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        refreshAll()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', refreshAll)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', refreshAll)
    }
  }, [refreshAll])

  // Red de seguridad: si el WebSocket se cae sin avisar, igual se actualiza cada 30 s
  // mientras la pantalla esta visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refreshAll()
    }, 30000)
    return () => clearInterval(id)
  }, [refreshAll])

  const weeksThisMonth = getWeeksEndingInMonth(currentMonthValue())

  const canRegisterEntrada = !lastRecord || lastRecord.type === 'salida'
  const canRegisterIngresoColacion = lastRecord?.type === 'entrada'
  const canRegisterSalidaColacion = lastRecord?.type === 'ingreso_colacion'
  const canRegisterSalida =
    lastRecord?.type === 'entrada' || lastRecord?.type === 'salida_colacion'

  async function registrarConFoto(type: 'entrada' | 'salida', photo: Blob) {
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
        type,
        photo_path: path,
      })

      if (insertError) throw insertError

      setMessage(`${TYPE_LABELS[type]} registrada correctamente.`)
      setShowCamera(false)
      setCameraAction(null)
      await loadRecords()
      await loadLastRecord()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Error registrando la ${TYPE_LABELS[type].toLowerCase()}.`)
    } finally {
      setBusy(false)
    }
  }

  async function registrarSimple(type: 'ingreso_colacion' | 'salida_colacion') {
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
      await loadLastRecord()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Error registrando el movimiento.')
    } finally {
      setBusy(false)
    }
  }

  const arqueoValues = {
    efectivo: Number(efectivo) || 0,
    debito: Number(debito) || 0,
    credito: Number(credito) || 0,
    transferencia: Number(transferencia) || 0,
  }
  const arqueoVentaTotal = ventaTotal(arqueoValues)

  async function handleSubmitArqueo(e: React.FormEvent) {
    e.preventDefault()
    setArqueoBusy(true)
    setArqueoError(null)
    setArqueoMessage(null)
    try {
      await submitArqueo(profile.id, currentDateValue(), arqueoValues)
      setEfectivo('')
      setDebito('')
      setCredito('')
      setTransferencia('')
      setArqueoMessage('Arqueo guardado correctamente.')
      await loadTodayArqueo()
      await loadWeeklySales()
    } catch (err) {
      setArqueoError(err instanceof Error ? err.message : 'Error guardando el arqueo')
    } finally {
      setArqueoBusy(false)
    }
  }

  function updatePendienteRow(i: number, field: 'cliente' | 'detalle' | 'monto', value: string) {
    setPendienteRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  async function handleAddPendiente(e: React.FormEvent) {
    e.preventDefault()
    if (pendienteBusyRef.current) return
    // Filas completamente vacias se ignoran; las incompletas o invalidas frenan el envio.
    const filled = pendienteRows.filter((r) => r.monto.trim() || r.cliente.trim())
    const parsed = filled.map((r) => ({
      monto: Number(r.monto),
      cliente: r.cliente.trim(),
      detalle: r.detalle.trim(),
    }))
    if (parsed.length === 0 || parsed.some((r) => !r.monto || r.monto <= 0 || !r.cliente)) {
      setPendienteError('Cada deuda necesita el nombre del cliente y un monto válido.')
      return
    }
    pendienteBusyRef.current = true
    setPendienteBusy(true)
    setPendienteError(null)
    try {
      await addPendientes(profile.id, parsed)
      setPendienteRows([{ cliente: '', detalle: '', monto: '' }])
      await loadPendientesRows()
    } catch (err) {
      setPendienteError(err instanceof Error ? err.message : 'Error registrando el pendiente')
    } finally {
      pendienteBusyRef.current = false
      setPendienteBusy(false)
    }
  }

  async function handleAbonar(ids: string[], monto: number, busyKey: string): Promise<boolean> {
    setPayingId(busyKey)
    setPendienteError(null)
    try {
      await abonarPendientes(ids, monto)
      await loadPendientesRows()
      return true
    } catch (err) {
      setPendienteError(err instanceof Error ? err.message : 'Error registrando el abono')
      return false
    } finally {
      setPayingId(null)
    }
  }

  async function handleCobrar(ids: string[], busyKey: string) {
    setPayingId(busyKey)
    try {
      await markPendientesPagados(ids)
      await loadPendientesRows()
    } catch (err) {
      setPendienteError(err instanceof Error ? err.message : 'Error marcando como pagado')
    } finally {
      setPayingId(null)
    }
  }

  const weeklySalesPct = Math.min(100, Math.round((weeklySales / WEEKLY_SALES_GOAL) * 100))

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

      <nav className="tab-nav">
        <button
          className={activeTab === 'inicio' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('inicio')}
        >
          Inicio
        </button>
        <button
          className={activeTab === 'productos' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('productos')}
        >
          Productos
        </button>
        <button
          className={activeTab === 'pedidos' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('pedidos')}
        >
          Pedidos
        </button>
        <button
          className={activeTab === 'arqueo' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('arqueo')}
        >
          Arqueo
        </button>
        <button
          className={activeTab === 'pendientes' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('pendientes')}
        >
          Pendientes
        </button>
        <button
          className={activeTab === 'limpieza' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('limpieza')}
        >
          Limpieza
        </button>
        <button
          className={activeTab === 'historial' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('historial')}
        >
          Historial
        </button>
      </nav>

      <div className="action-row">
        <button
          className="btn btn-primary"
          disabled={!canRegisterEntrada || busy}
          onClick={() => {
            setCameraAction('entrada')
            setShowCamera(true)
          }}
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
          onClick={() => {
            setCameraAction('salida')
            setShowCamera(true)
          }}
        >
          Registrar salida
        </button>
      </div>

      {message && <p className="info-text">{message}</p>}

      {activeTab === 'inicio' && paySummary && (
        <section className="card pay-card">
          <h2>Mi sueldo</h2>
          <p>
            Sueldo base:{' '}
            <strong>
              {formatCLP(paySummary.baseAmount)}
              {paySummary.payFrequency === 'monthly' ? ' mensual' : ' semanal'}
            </strong>
          </p>
          <p className="subtitle">
            Cada hora extra vale <strong>{formatCLP(OVERTIME_RATE_PER_HOUR)}</strong>
          </p>
          <p>
            Horas extra este mes: <strong>{formatHoursMinutes(paySummary.overtimeMs)}</strong> →{' '}
            <strong>{formatCLP(paySummary.overtimePay)}</strong>
          </p>
          {paySummary.tuesdayBonusCount > 0 && (
            <p>
              Bono martes: {paySummary.tuesdayBonusCount} × {formatCLP(profile.tuesday_bonus)} ={' '}
              <strong>{formatCLP(paySummary.tuesdayBonusTotal)}</strong>
            </p>
          )}
          {profile.weekly_bonus_eligible && (
            <p>
              Bono semanal este mes:{' '}
              {weeksThisMonth.map((week) => {
                const earned = isWeekEarned(weeklyBonusRows, week)
                return (
                  <span
                    key={week.end.toISOString()}
                    className={earned ? 'bonus-week earned' : 'bonus-week'}
                    title={formatWeekLabel(week)}
                  >
                    {formatWeekLabel(week)}
                  </span>
                )
              })}{' '}
              → <strong>{formatCLP(totalEarned(weeklyBonusRows))}</strong>
            </p>
          )}
          {feriadoSummary && feriadoSummary.days.length > 0 && (
            <p>
              Feriados/irrenunciables trabajados este mes:{' '}
              {feriadoSummary.days.map((d) => (
                <span key={d.fecha}>
                  {d.nombre} ({formatCLP(d.monto)}){' '}
                </span>
              ))}
              → <strong>{formatCLP(feriadoSummary.total)}</strong>
            </p>
          )}
          {paySummary.payFrequency === 'monthly' && (
            <p className="pay-total">
              Total del mes:{' '}
              <strong>
                {formatCLP(
                  paySummary.baseAmount +
                    paySummary.overtimePay +
                    paySummary.tuesdayBonusTotal +
                    totalEarned(weeklyBonusRows) +
                    (feriadoSummary?.total ?? 0),
                )}
              </strong>
            </p>
          )}
        </section>
      )}

      {activeTab === 'productos' && <ProductosScanner />}

      {activeTab === 'pedidos' && <PedidosTienda />}

      {activeTab === 'limpieza' && <ReporteLimpieza workerId={profile.id} />}

      {activeTab === 'arqueo' && (
        <>
          <section className="card">
            <h2>Meta semanal de ventas</h2>
            <p className="subtitle">
              Semana {formatWeekLabel(getCurrentWeek())} · Meta: {formatCLP(WEEKLY_SALES_GOAL)}
            </p>
            <div className="goal-bar">
              <div className="goal-bar-fill" style={{ width: `${weeklySalesPct}%` }} />
            </div>
            <p>
              Venta de la semana (incluye deudas cobradas): <strong>{formatCLP(weeklySales)}</strong> ({weeklySalesPct}%)
            </p>
          </section>

          <section className="card">
            <h2>Arqueo del día</h2>
            <p className="subtitle">Ingresa las ventas de tu turno de hoy.</p>
            <form onSubmit={handleSubmitArqueo} className="worker-form">
          <label>
            Efectivo
            <input
              type="number"
              min={0}
              value={efectivo}
              onChange={(e) => setEfectivo(e.target.value)}
            />
          </label>
          <label>
            Débito
            <input
              type="number"
              min={0}
              value={debito}
              onChange={(e) => setDebito(e.target.value)}
            />
          </label>
          <label>
            Crédito
            <input
              type="number"
              min={0}
              value={credito}
              onChange={(e) => setCredito(e.target.value)}
            />
          </label>
          <label>
            Transferencia
            <input
              type="number"
              min={0}
              value={transferencia}
              onChange={(e) => setTransferencia(e.target.value)}
            />
          </label>
          <p>
            Venta total: <strong>{formatCLP(arqueoVentaTotal)}</strong>
          </p>
          {arqueoError && <p className="error-text">{arqueoError}</p>}
          {arqueoMessage && <p className="info-text">{arqueoMessage}</p>}
          <button type="submit" className="btn btn-primary" disabled={arqueoBusy}>
            {arqueoBusy ? 'Guardando...' : 'Guardar arqueo'}
          </button>
        </form>

        {todayArqueo.length > 0 && (
          <>
            <h2>Arqueos de hoy</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Efectivo</th>
                  <th>Débito</th>
                  <th>Crédito</th>
                  <th>Transferencia</th>
                  <th>Venta total</th>
                </tr>
              </thead>
              <tbody>
                {todayArqueo.map((a) => (
                  <tr key={a.id}>
                    <td>{formatCLP(a.efectivo)}</td>
                    <td>{formatCLP(a.debito)}</td>
                    <td>{formatCLP(a.credito)}</td>
                    <td>{formatCLP(a.transferencia)}</td>
                    <td>{formatCLP(ventaTotal(a))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
          </section>
        </>
      )}

      {activeTab === 'pendientes' && (
      <section className="card">
        <h2>Pendientes (fiado)</h2>
        <p className="subtitle">
          Si le fiaste algo a alguien, regístralo aquí con su nombre. Las deudas de una misma
          persona se juntan, y se puede cobrar una por una o todas juntas.
        </p>
        <form onSubmit={handleAddPendiente} className="worker-form">
          <datalist id="clientes-fiado">
            {agruparPorCliente(pendientes).map((g) => (
              <option key={g.key} value={g.nombre} />
            ))}
          </datalist>
          {pendienteRows.map((r, i) => (
            <div key={i} className="report-row">
              <label className="chat-input">
                Cliente
                <input
                  list="clientes-fiado"
                  value={r.cliente}
                  onChange={(e) => updatePendienteRow(i, 'cliente', e.target.value)}
                  placeholder="Ej: Juan, depto 202"
                />
              </label>
              <label className="chat-input">
                Detalle (opcional)
                <input
                  value={r.detalle}
                  onChange={(e) => updatePendienteRow(i, 'detalle', e.target.value)}
                  placeholder="Ej: 2 Coca-Cola y pan"
                />
              </label>
              <label>
                Monto
                <input
                  type="number"
                  min={0}
                  value={r.monto}
                  onChange={(e) => updatePendienteRow(i, 'monto', e.target.value)}
                />
              </label>
              {pendienteRows.length > 1 && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setPendienteRows((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  Quitar
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => setPendienteRows((prev) => [...prev, { cliente: '', detalle: '', monto: '' }])}
          >
            + Agregar otro cliente
          </button>
          {pendienteError && <p className="error-text">{pendienteError}</p>}
          <button type="submit" className="btn btn-primary" disabled={pendienteBusy}>
            {pendienteBusy ? 'Guardando...' : pendienteRows.length > 1 ? 'Registrar pendientes' : 'Registrar pendiente'}
          </button>
        </form>

        <p>
          Total pendiente por cobrar: <strong>{formatCLP(totalPendiente(pendientes))}</strong>
        </p>

        <PendientesPorCliente
          pendientes={pendientes}
          nameDirectory={nameDirectory}
          busyKey={payingId}
          onCobrar={handleCobrar}
          onAbonar={handleAbonar}
        />
      </section>
      )}

      {showCamera && cameraAction && (
        <CameraCapture
          onCapture={(photo) => registrarConFoto(cameraAction, photo)}
          onCancel={() => {
            setShowCamera(false)
            setCameraAction(null)
          }}
        />
      )}

      {activeTab === 'historial' && (
        <section className="card">
      <div className="section-header">
        <h2>Tu historial</h2>
        <div className="table-controls">
          <select value={filterMode} onChange={(e) => setFilterMode(e.target.value as 'day' | 'month')}>
            <option value="day">Por día</option>
            <option value="month">Por mes</option>
          </select>
          {filterMode === 'day' ? (
            <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
          ) : (
            <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} />
          )}
        </div>
      </div>
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
        </section>
      )}
      <AsistenteTienda />
    </div>
  )
}
