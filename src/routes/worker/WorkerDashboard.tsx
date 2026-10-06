import { Fragment, useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Attendance, Profile } from '../../types'
import { CameraCapture } from '../../components/CameraCapture'
import { Logo } from '../../components/Logo'
import { ProductosScanner } from '../../components/ProductosScanner'
import { InventarioAdmin } from '../../components/InventarioAdmin'
import { AgregarPendientes } from '../../components/AgregarPendientes'
import { PendientesPorCliente } from '../../components/PendientesPorCliente'
import { HistorialPedidosTienda } from '../../components/HistorialPedidosTienda'
import { ReporteLimpieza } from '../../components/ReporteLimpieza'
import { AsistenteTienda } from '../../components/AsistenteTienda'
import { AlertaPedidosNuevos } from '../../components/AlertaPedidosNuevos'
import { MesActual } from '../../components/MesActual'
import { NotificacionesPush } from '../../components/NotificacionesPush'
import { HistorialPagos } from '../../components/HistorialPagos'
import { PedidosTienda } from '../../components/PedidosTienda'
import { VentasOnlineDia } from '../../components/VentasOnlineDia'
import { computeShifts, formatHoursMinutes } from '../../lib/hours'
import {
  annotateOvertime,
  computePaySummary,
  formatCLP,
  OVERTIME_RATE_PER_HOUR,
  type PaySummary,
} from '../../lib/payroll'
import {
  WEEKLY_BONUS_AMOUNT,
  formatWeekLabel,
  getCurrentWeek,
  getWeeksEndingInMonth,
  isWeekEarned,
  loadWeeklyBonusForWorker,
  loadWeeklyBonusRow,
  totalEarned,
  type WeeklyBonusRow,
} from '../../lib/weeklyBonus'
import {
  corregirArqueoDia,
  filasVigentesPorTrabajador,
  loadArqueoForWorkerDay,
  loadWeeklySalesTotal,
  cerrarArqueo,
  textoOrigenArqueo,
  ventaTotal,
  WEEKLY_SALES_GOAL,
  type ArqueoEntry,
} from '../../lib/arqueo'
import {
  loadPendientes,
  markPendientesPagados,
  abonarPendientes,
  type MetodoAbono,
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
  const [corrigiendoArqueo, setCorrigiendoArqueo] = useState(false)
  const [verArqueoFecha, setVerArqueoFecha] = useState(currentDateValue())
  const [editArqueoValores, setEditArqueoValores] = useState({
    efectivo: '',
    tarjeta: '',
    transferencia: '',
    qr: '',
  })
  const [editArqueoBusy, setEditArqueoBusy] = useState(false)
  const [cerrandoArqueo, setCerrandoArqueo] = useState(false)
  const [editArqueoError, setEditArqueoError] = useState<string | null>(null)
  const [pendientes, setPendientes] = useState<PendienteEntry[]>([])
  const [nameDirectory, setNameDirectory] = useState<Record<string, string>>({})
  const [pendienteError, setPendienteError] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [pedidosPendientes, setPedidosPendientes] = useState(0)
  // Algunos trabajadores tienen habilitado el mismo inventario completo que usa el admin.
  const [puedeInventarioCompleto, setPuedeInventarioCompleto] = useState(false)

  useEffect(() => {
    supabase
      .rpc('ingreso_puede_editar_productos')
      .then(({ data }) => setPuedeInventarioCompleto(data === true))
  }, [])
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
    let start: Date
    let end: Date
    if (profile.pay_frequency === 'weekly') {
      const week = getCurrentWeek()
      start = new Date(week.start.getFullYear(), week.start.getMonth(), week.start.getDate(), 0, 0, 0)
      end = new Date(week.end.getFullYear(), week.end.getMonth(), week.end.getDate() + 1, 0, 0, 0)
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0)
    }

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
    if (profile.pay_frequency === 'weekly') {
      // La semana en curso puede terminar (domingo) en el mes siguiente; se pide aparte para no perderla.
      const row = await loadWeeklyBonusRow(profile.id, getCurrentWeek())
      setWeeklyBonusRows(row ? [row] : [])
      return
    }
    const rows = await loadWeeklyBonusForWorker(profile.id, currentMonthValue())
    setWeeklyBonusRows(rows)
  }, [profile.id])

  useEffect(() => {
    loadBonusRows()
  }, [loadBonusRows])

  const loadTodayArqueo = useCallback(async () => {
    const rows = await loadArqueoForWorkerDay(profile.id, verArqueoFecha)
    setTodayArqueo(rows)
  }, [profile.id, verArqueoFecha])

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

  function abrirCorregirArqueo() {
    // Se parte desde la fila mas reciente (la que vale para el total hoy), no de la suma de todas.
    const vigente = filasVigentesPorTrabajador(todayArqueo).find((a) => !a.cerrado_at)
    const sumaActual = vigente ?? { efectivo: 0, tarjeta: 0, transferencia: 0, qr: 0 }
    setCorrigiendoArqueo(true)
    setEditArqueoError(null)
    setEditArqueoValores({
      efectivo: String(sumaActual.efectivo),
      tarjeta: String(sumaActual.tarjeta),
      transferencia: String(sumaActual.transferencia),
      qr: String(sumaActual.qr),
    })
  }

  async function handleCerrarArqueo() {
    if (cerrandoArqueo) return
    setCerrandoArqueo(true)
    try {
      await cerrarArqueo(profile.id, currentDateValue())
      await loadTodayArqueo()
      await loadWeeklySales()
    } catch (err) {
      setEditArqueoError(err instanceof Error ? err.message : 'No se pudo cerrar el arqueo')
    } finally {
      setCerrandoArqueo(false)
    }
  }

  async function handleGuardarEdicionArqueo() {
    if (editArqueoBusy) return
    const valores = {
      efectivo: Number(editArqueoValores.efectivo) || 0,
      tarjeta: Number(editArqueoValores.tarjeta) || 0,
      transferencia: Number(editArqueoValores.transferencia) || 0,
      qr: Number(editArqueoValores.qr) || 0,
    }
    if (Object.values(valores).some((v) => v < 0)) {
      setEditArqueoError('Los montos no pueden ser negativos.')
      return
    }
    setEditArqueoBusy(true)
    setEditArqueoError(null)
    try {
      await corregirArqueoDia(profile.id, verArqueoFecha, valores)
      setCorrigiendoArqueo(false)
      await loadTodayArqueo()
      await loadWeeklySales()
    } catch (err) {
      setEditArqueoError(err instanceof Error ? err.message : 'Error guardando los cambios')
    } finally {
      setEditArqueoBusy(false)
    }
  }

  async function handleAbonar(ids: string[], monto: number, busyKey: string, metodo: MetodoAbono): Promise<boolean> {
    setPayingId(busyKey)
    setPendienteError(null)
    try {
      await abonarPendientes(ids, monto, metodo)
      await loadPendientesRows()
      return true
    } catch (err) {
      setPendienteError(err instanceof Error ? err.message : 'Error registrando el abono')
      return false
    } finally {
      setPayingId(null)
    }
  }

  async function handleCobrar(ids: string[], busyKey: string, metodo: MetodoAbono) {
    setPayingId(busyKey)
    try {
      await markPendientesPagados(ids, metodo)
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
      <MesActual />
      <header className="page-header">
        <div className="brand-row">
          <Logo size={48} />
          <div>
            <h1>Hola, {profile.full_name}</h1>
            <p className="subtitle">Registra tu entrada, colación o salida</p>
          </div>
        </div>
        <div className="table-controls">
          <NotificacionesPush />
          <button className="btn btn-secondary" onClick={() => supabase.auth.signOut()}>
            Cerrar sesión
          </button>
        </div>
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
          {pedidosPendientes > 0 && <span className="tab-badge">{pedidosPendientes}</span>}
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
            if (!window.confirm('¿Registrar ENTRADA ahora? Revisa que sea el momento correcto.')) return
            setCameraAction('entrada')
            setShowCamera(true)
          }}
        >
          Registrar entrada
        </button>
        <button
          className="btn btn-secondary"
          disabled={!canRegisterIngresoColacion || busy}
          onClick={() => {
            if (!window.confirm('¿Registrar INGRESO A COLACIÓN ahora? Solo confirma si ya vas a colación.')) return
            registrarSimple('ingreso_colacion')
          }}
        >
          Ingreso colación
        </button>
        <button
          className="btn btn-secondary"
          disabled={!canRegisterSalidaColacion || busy}
          onClick={() => {
            if (!window.confirm('¿Registrar SALIDA DE COLACIÓN ahora? Solo confirma si ya volviste de colación.')) return
            registrarSimple('salida_colacion')
          }}
        >
          Salida colación
        </button>
        <button
          className="btn btn-danger"
          disabled={!canRegisterSalida || busy}
          onClick={() => {
            if (!window.confirm('¿Registrar SALIDA ahora? Esta marca termina tu jornada.')) return
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
            Horas extra {paySummary.payFrequency === 'weekly' ? 'esta semana' : 'este mes'}:{' '}
            <strong>{formatHoursMinutes(paySummary.overtimeMs)}</strong> →{' '}
            <strong>{formatCLP(paySummary.overtimePay)}</strong>
          </p>
          {paySummary.tuesdayBonusCount > 0 && (
            <p>
              Bono martes: {paySummary.tuesdayBonusCount} × {formatCLP(profile.tuesday_bonus)} ={' '}
              <strong>{formatCLP(paySummary.tuesdayBonusTotal)}</strong>
            </p>
          )}
          {profile.weekly_bonus_eligible && paySummary.payFrequency === 'weekly' && (
            <p>
              Bono semanal esta semana:{' '}
              <span className={isWeekEarned(weeklyBonusRows, getCurrentWeek()) ? 'bonus-week earned' : 'bonus-week'}>
                {formatWeekLabel(getCurrentWeek())}
              </span>{' '}
              →{' '}
              <strong>
                {formatCLP(isWeekEarned(weeklyBonusRows, getCurrentWeek()) ? WEEKLY_BONUS_AMOUNT : 0)}
              </strong>
            </p>
          )}
          {profile.weekly_bonus_eligible && paySummary.payFrequency !== 'weekly' && (
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
              Feriados/irrenunciables trabajados {paySummary.payFrequency === 'weekly' ? 'esta semana' : 'este mes'}:{' '}
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
          {paySummary.payFrequency === 'weekly' && (
            <p className="pay-total">
              Total de esta semana ({formatWeekLabel(getCurrentWeek())}):{' '}
              <strong>
                {formatCLP(
                  paySummary.baseAmount +
                    paySummary.overtimePay +
                    paySummary.tuesdayBonusTotal +
                    (isWeekEarned(weeklyBonusRows, getCurrentWeek()) ? WEEKLY_BONUS_AMOUNT : 0) +
                    (feriadoSummary?.total ?? 0),
                )}
              </strong>
            </p>
          )}
        </section>
      )}

      {activeTab === 'inicio' && <HistorialPagos profile={profile} />}

      {activeTab === 'productos' && (puedeInventarioCompleto ? <InventarioAdmin /> : <ProductosScanner />)}

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
            <p className="subtitle">
                El arqueo se completa solo con tus pedidos y abonos cobrados. Si algún monto está mal, usa
                "Corregir totales del día" más abajo.
            </p>

        <div className="section-header">
          <h2>{verArqueoFecha === currentDateValue() ? 'Arqueos de hoy' : `Arqueos del ${verArqueoFecha}`}</h2>
          <input type="date" value={verArqueoFecha} onChange={(e) => setVerArqueoFecha(e.target.value)} />
        </div>
        {todayArqueo.length === 0 && <p className="subtitle">No hay arqueo registrado ese día.</p>}
        {todayArqueo.length > 0 && (
          <>
            <div className="arqueo-lista">
              {todayArqueo.map((a) => (
                <div key={a.id} className="arqueo-card">
                  <div className="arqueo-card-head">
                    <span className="subtitle">
                      {textoOrigenArqueo(a)} · Arqueo {a.turno ?? 1}
                      {a.cerrado_at ? ' · cerrado' : ''}
                    </span>
                  </div>
                  <div className="arqueo-card-montos">
                    <span className="arqueo-chip">Efectivo {formatCLP(a.efectivo)}</span>
                    <span className="arqueo-chip">Tarjeta {formatCLP(a.tarjeta)}</span>
                    {a.transferencia > 0 && <span className="arqueo-chip">Transferencia {formatCLP(a.transferencia)}</span>}
                    {a.qr > 0 && <span className="arqueo-chip">QR {formatCLP(a.qr)}</span>}
                  </div>
                  <div className="arqueo-card-foot">
                    <span>
                      Total: <strong>{formatCLP(ventaTotal(a))}</strong>
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {verArqueoFecha === currentDateValue() && (
              <div className="arqueo-acciones">
                <button type="button" className="btn btn-secondary btn-small" onClick={abrirCorregirArqueo}>
                  Corregir totales del día
                </button>
                {filasVigentesPorTrabajador(todayArqueo).some((a) => !a.cerrado_at) && (
                  <button type="button" className="btn btn-secondary btn-small" onClick={handleCerrarArqueo} disabled={cerrandoArqueo}>
                    {cerrandoArqueo ? 'Cerrando...' : 'Cerrar arqueo'}
                  </button>
                )}
              </div>
            )}
          </>
        )}
        <p className="subtitle">
          Puedes corregir tu arqueo solo durante el mismo día; después ya no se puede editar. Si cierras el arqueo y
          sigues vendiendo, las ventas nuevas van al siguiente arqueo y el total del día suma todos.
        </p>
        <VentasOnlineDia
          fecha={verArqueoFecha}
          arqueoTotal={filasVigentesPorTrabajador(todayArqueo).reduce((sum, a) => sum + ventaTotal(a), 0)}
        />
          </section>
          <HistorialPedidosTienda />
        </>
      )}

      {corrigiendoArqueo && (
        <div className="camera-overlay">
          <div className="camera-modal">
            <div className="modal-top">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setCorrigiendoArqueo(false)}
                disabled={editArqueoBusy}
              >
                ← Cancelar
              </button>
              <h2>Corregir totales del día</h2>
            </div>
            <p className="subtitle">
              Pon el total real de hoy en cada método; se guarda como una fila nueva debajo, sin borrar la que
              dejó la app, para poder comparar.
            </p>
            {(['efectivo', 'tarjeta', 'transferencia', 'qr'] as const).map((campo) => (
              <label key={campo}>
                {campo === 'efectivo'
                  ? 'Efectivo'
                  : campo === 'tarjeta'
                    ? 'Tarjeta'
                    : campo === 'transferencia'
                      ? 'Transferencia'
                      : 'QR'}
                <input
                  type="number"
                  min={0}
                  value={editArqueoValores[campo]}
                  onChange={(e) =>
                    setEditArqueoValores({ ...editArqueoValores, [campo]: e.target.value })
                  }
                />
              </label>
            ))}
            <p>
              Venta total:{' '}
              <strong>
                {formatCLP(
                  ventaTotal({
                    efectivo: Number(editArqueoValores.efectivo) || 0,
                    tarjeta: Number(editArqueoValores.tarjeta) || 0,
                    transferencia: Number(editArqueoValores.transferencia) || 0,
                    qr: Number(editArqueoValores.qr) || 0,
                  }),
                )}
              </strong>
            </p>
            {editArqueoError && <p className="error-text">{editArqueoError}</p>}
            <div className="camera-actions">
              <button
                className="btn btn-primary"
                onClick={handleGuardarEdicionArqueo}
                disabled={editArqueoBusy}
              >
                {editArqueoBusy ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'pendientes' && (
      <section className="card">
        <h2>Pendientes (fiado)</h2>
        <p className="subtitle">
          Si le fiaste algo a alguien, regístralo aquí con su nombre. Las deudas de una misma
          persona se juntan, y se puede cobrar una por una o todas juntas.
        </p>
        {pendienteError && <p className="error-text">{pendienteError}</p>}
        <AgregarPendientes workerId={profile.id} pendientes={pendientes} onGuardado={loadPendientesRows} />

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
      <AlertaPedidosNuevos onVerPedidos={() => setActiveTab('pedidos')} onCantidad={setPedidosPendientes} />
      <AsistenteTienda />
    </div>
  )
}
