import { Fragment, useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Attendance, Profile, WeeklySchedule } from '../../types'
import { Logo } from '../../components/Logo'
import { HistorialPedidosTienda } from '../../components/HistorialPedidosTienda'
import { ReporteLimpieza } from '../../components/ReporteLimpieza'
import { AsistenteTienda } from '../../components/AsistenteTienda'
import { PendientesPorCliente } from '../../components/PendientesPorCliente'
import { InventarioAdmin } from '../../components/InventarioAdmin'
import { PedidosTienda } from '../../components/PedidosTienda'
import { downloadMonthlyHoursPdf } from '../../lib/monthlyReport'
import { formatCLP } from '../../lib/payroll'
import {
  WEEKLY_BONUS_AMOUNT,
  formatWeekLabel,
  getCurrentWeek,
  getWeeksEndingInMonth,
  isWeekEarned,
  loadWeeklyBonusForMonth,
  setWeeklyBonusEarned,
  type WeekRange,
  type WeeklyBonusRow,
} from '../../lib/weeklyBonus'
import {
  loadArqueoForDate,
  loadWeeklySalesTotal,
  ventaTotal,
  WEEKLY_SALES_GOAL,
  type ArqueoRowWithWorker,
} from '../../lib/arqueo'
import { downloadSalesPdf } from '../../lib/salesReport'
import {
  loadPendientes,
  markPendientesPagados,
  abonarPendientes,
  totalPendiente,
  type PendienteEntry,
} from '../../lib/pendientes'
import { loadNameDirectory } from '../../lib/directory'
import {
  addFeriado,
  deleteFeriado,
  loadFeriados,
  loadFeriadoExclusions,
  setFeriadoExclusion,
  FERIADO_BONUS,
  IRRENUNCIABLE_BONUS,
  type Feriado,
  type FeriadoExclusion,
} from '../../lib/feriados'

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
  days: Record<number, { enabled: boolean; start: string; end: string }>
  pay_amount: string
  pay_frequency: 'weekly' | 'monthly'
  tuesday_bonus: string
  weekly_bonus_eligible: boolean
}

function scheduleFormFromProfile(w: Profile): ScheduleForm {
  const days: ScheduleForm['days'] = {}
  for (const d of WEEKDAYS) {
    const existing = w.weekly_schedule?.[String(d.value)]
    days[d.value] = {
      enabled: !!existing,
      start: existing?.start ?? '09:00',
      end: existing?.end ?? '18:00',
    }
  }
  return {
    days,
    pay_amount: w.pay_amount?.toString() ?? '',
    pay_frequency: w.pay_frequency ?? 'monthly',
    tuesday_bonus: w.tuesday_bonus ? w.tuesday_bonus.toString() : '',
    weekly_bonus_eligible: w.weekly_bonus_eligible,
  }
}

function describeSchedule(w: Profile): string {
  const entries = WEEKDAYS.filter((d) => w.weekly_schedule?.[String(d.value)])
  const pay = w.pay_amount
    ? `${formatCLP(w.pay_amount)} ${w.pay_frequency === 'monthly' ? 'mensual' : 'semanal'}`
    : 'sin sueldo configurado'
  const bonus = w.tuesday_bonus > 0 ? ` · Bono martes ${formatCLP(w.tuesday_bonus)}` : ''
  const meta = w.weekly_bonus_eligible ? ' · Participa en bono de meta' : ' · No participa en bono de meta'

  if (entries.length === 0) {
    return `Sin horario configurado · ${pay}${bonus}${meta}`
  }

  const days = entries
    .map((d) => {
      const s = w.weekly_schedule![String(d.value)]!
      return `${d.label} ${s.start}–${s.end}`
    })
    .join(', ')
  return `${days} · ${pay}${bonus}${meta}`
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
  const [bonusMonth, setBonusMonth] = useState<string>(currentMonthValue())
  const [bonusRows, setBonusRows] = useState<WeeklyBonusRow[]>([])
  const [bonusBusyKey, setBonusBusyKey] = useState<string | null>(null)
  const [bonusError, setBonusError] = useState<string | null>(null)
  const [lastStatuses, setLastStatuses] = useState<Record<string, Attendance['type']>>({})
  const [salidaBusyId, setSalidaBusyId] = useState<string | null>(null)
  const [salidaError, setSalidaError] = useState<string | null>(null)
  const [arqueoDate, setArqueoDate] = useState<string>(currentDateValue())
  const [arqueoRows, setArqueoRows] = useState<ArqueoRowWithWorker[]>([])
  const [weeklySales, setWeeklySales] = useState<number>(0)
  const [salesReportMonth, setSalesReportMonth] = useState<string>(currentMonthValue())
  const [salesReportBusy, setSalesReportBusy] = useState<'week' | 'month' | null>(null)
  const [salesReportError, setSalesReportError] = useState<string | null>(null)
  const [pendientes, setPendientes] = useState<PendienteEntry[]>([])
  const [nameDirectory, setNameDirectory] = useState<Record<string, string>>({})
  const [payingId, setPayingId] = useState<string | null>(null)
  const [pendienteError, setPendienteError] = useState<string | null>(null)
  const [feriados, setFeriados] = useState<Feriado[]>([])
  const [feriadoFecha, setFeriadoFecha] = useState('')
  const [feriadoNombre, setFeriadoNombre] = useState('')
  const [feriadoTipo, setFeriadoTipo] = useState<'feriado' | 'irrenunciable'>('feriado')
  const [feriadoBusy, setFeriadoBusy] = useState(false)
  const [feriadoError, setFeriadoError] = useState<string | null>(null)
  const [deletingFeriadoId, setDeletingFeriadoId] = useState<string | null>(null)
  const [feriadoExclusions, setFeriadoExclusions] = useState<FeriadoExclusion[]>([])
  const [exclusionBusyKey, setExclusionBusyKey] = useState<string | null>(null)
  const [exclusionModalFeriado, setExclusionModalFeriado] = useState<Feriado | null>(null)
  const [tiempoWorker, setTiempoWorker] = useState<Profile | null>(null)
  const [tiempoCustom, setTiempoCustom] = useState('')
  const [tiempoBusy, setTiempoBusy] = useState(false)
  const [tiempoError, setTiempoError] = useState<string | null>(null)
  const [extensiones, setExtensiones] = useState<Record<string, number>>({})
  const [activeTab, setActiveTab] = useState<
    'trabajadores' | 'reportes' | 'ventas' | 'pedidos' | 'pendientes' | 'inventario' | 'limpieza' | 'registros'
  >('trabajadores')

  const loadLastStatuses = useCallback(async () => {
    const { data } = await supabase.rpc('ingreso_last_attendance')
    const map: Record<string, Attendance['type']> = {}
    for (const row of (data as { worker_id: string; type: Attendance['type'] }[]) ?? []) {
      map[row.worker_id] = row.type
    }
    setLastStatuses(map)
  }, [])

  const loadArqueoRows = useCallback(async () => {
    const rows = await loadArqueoForDate(arqueoDate)
    setArqueoRows(rows)
  }, [arqueoDate])

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

  const loadFeriadosRows = useCallback(async () => {
    const rows = await loadFeriados()
    setFeriados(rows)
  }, [])

  const loadFeriadoExclusionsRows = useCallback(async () => {
    const rows = await loadFeriadoExclusions()
    setFeriadoExclusions(rows)
  }, [])

  async function toggleFeriadoExclusion(workerId: string, fecha: string) {
    const key = `${workerId}-${fecha}`
    setExclusionBusyKey(key)
    try {
      const current = feriadoExclusions.some(
        (e) => e.worker_id === workerId && e.fecha === fecha,
      )
      await setFeriadoExclusion(workerId, fecha, !current)
      await loadFeriadoExclusionsRows()
    } catch (err) {
      setFeriadoError(err instanceof Error ? err.message : 'Error actualizando la exclusión')
    } finally {
      setExclusionBusyKey(null)
    }
  }

  const loadExtensiones = useCallback(async () => {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
    const { data } = await supabase
      .from('ingreso_extension_horas')
      .select('worker_id, minutos')
      .eq('fecha', hoy)
    const map: Record<string, number> = {}
    for (const r of (data as { worker_id: string; minutos: number }[]) ?? []) {
      map[r.worker_id] = r.minutos
    }
    setExtensiones(map)
  }, [])

  useEffect(() => {
    loadExtensiones()
  }, [loadExtensiones])

  useEffect(() => {
    loadArqueoRows()
  }, [loadArqueoRows])

  useEffect(() => {
    loadWeeklySales()
  }, [loadWeeklySales])

  useEffect(() => {
    loadPendientesRows()
    loadDirectory()
  }, [loadPendientesRows, loadDirectory])

  useEffect(() => {
    loadFeriadosRows()
    loadFeriadoExclusionsRows()
  }, [loadFeriadosRows, loadFeriadoExclusionsRows])

  useEffect(() => {
    const channel = supabase
      .channel('ingreso_arqueo_admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingreso_arqueo' }, () => {
        loadArqueoRows()
        loadWeeklySales()
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingreso_pendientes' },
        () => {
          loadPendientesRows()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingreso_extension_horas' },
        () => {
          loadExtensiones()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingreso_feriados' },
        () => {
          loadFeriadosRows()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingreso_feriado_exclusion' },
        () => {
          loadFeriadoExclusionsRows()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [
    loadArqueoRows,
    loadWeeklySales,
    loadPendientesRows,
    loadFeriadosRows,
    loadFeriadoExclusionsRows,
    loadExtensiones,
  ])

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
    loadLastStatuses()
  }, [loadLastStatuses])

  useEffect(() => {
    if (!reportWorker && workers.length > 0) {
      setReportWorker(workers[0].id)
    }
  }, [workers, reportWorker])

  const loadBonusRows = useCallback(async () => {
    try {
      const rows = await loadWeeklyBonusForMonth(bonusMonth)
      setBonusRows(rows)
    } catch (err) {
      setBonusError(err instanceof Error ? err.message : 'Error cargando el bono semanal')
    }
  }, [bonusMonth])

  useEffect(() => {
    loadBonusRows()
  }, [loadBonusRows])

  useEffect(() => {
    const channel = supabase
      .channel('ingreso_weekly_bonus_admin')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingreso_weekly_bonus' },
        () => {
          loadBonusRows()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadBonusRows])

  function isBonusEarned(workerId: string, week: WeekRange): boolean {
    return isWeekEarned(
      bonusRows.filter((r) => r.worker_id === workerId),
      week,
    )
  }

  async function toggleBonus(workerId: string, week: WeekRange) {
    const key = `${workerId}-${week.end.toISOString()}`
    setBonusBusyKey(key)
    setBonusError(null)
    try {
      const current = isBonusEarned(workerId, week)
      await setWeeklyBonusEarned(workerId, week, !current)
      await loadBonusRows()
    } catch (err) {
      setBonusError(err instanceof Error ? err.message : 'Error guardando el bono')
    } finally {
      setBonusBusyKey(null)
    }
  }

  useEffect(() => {
    const channel = supabase
      .channel('ingreso_attendance_admin')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingreso_attendance' },
        () => {
          loadRecords()
          loadLastStatuses()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadRecords, loadLastStatuses])

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

  async function sumarTiempo(minutos: number) {
    if (!tiempoWorker || tiempoBusy) return
    if (!Number.isFinite(minutos) || minutos <= 0) {
      setTiempoError('Ingresa una cantidad de minutos válida')
      return
    }
    setTiempoBusy(true)
    setTiempoError(null)
    try {
      const { error } = await supabase.rpc('ingreso_sumar_tiempo', {
        p_worker: tiempoWorker.id,
        p_minutos: Math.round(minutos),
      })
      if (error) throw error
      await loadExtensiones()
      await loadRecords()
      await loadLastStatuses()
      setTiempoWorker(null)
      setTiempoCustom('')
    } catch (err) {
      setTiempoError(err instanceof Error ? err.message : 'Error sumando tiempo')
    } finally {
      setTiempoBusy(false)
    }
  }

  async function marcarSalidaManual(workerId: string) {
    setSalidaBusyId(workerId)
    setSalidaError(null)
    try {
      const { error } = await supabase.from('ingreso_attendance').insert({
        worker_id: workerId,
        type: 'salida',
      })
      if (error) throw error
      await loadRecords()
      await loadLastStatuses()
    } catch (err) {
      setSalidaError(err instanceof Error ? err.message : 'Error marcando la salida')
    } finally {
      setSalidaBusyId(null)
    }
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
            days: {
              ...f.days,
              [day]: { ...f.days[day], enabled: !f.days[day].enabled },
            },
          }
        : f,
    )
  }

  function updateScheduleDayTime(day: number, field: 'start' | 'end', value: string) {
    setScheduleForm((f) =>
      f
        ? {
            ...f,
            days: {
              ...f.days,
              [day]: { ...f.days[day], [field]: value },
            },
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

    const weeklySchedule: WeeklySchedule = {}
    for (const [day, config] of Object.entries(scheduleForm.days)) {
      if (config.enabled) {
        weeklySchedule[day] = { start: config.start, end: config.end }
      }
    }

    const { error } = await supabase
      .from('ingreso_profiles')
      .update({
        weekly_schedule: weeklySchedule,
        pay_amount: payAmount,
        pay_frequency: scheduleForm.pay_frequency,
        tuesday_bonus: tuesdayBonus,
        weekly_bonus_eligible: scheduleForm.weekly_bonus_eligible,
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

  async function handleDownloadWeeklySales() {
    setSalesReportBusy('week')
    setSalesReportError(null)
    try {
      const week = getCurrentWeek()
      await downloadSalesPdf({
        start: week.start,
        end: week.end,
        title: `Reporte de ventas — semana ${formatWeekLabel(week)}`,
        fileSuffix: `semana-${week.end.toISOString().slice(0, 10)}`,
        goal: WEEKLY_SALES_GOAL,
      })
    } catch (err) {
      setSalesReportError(err instanceof Error ? err.message : 'Error generando el PDF')
    } finally {
      setSalesReportBusy(null)
    }
  }

  async function handleDownloadMonthlySales() {
    setSalesReportBusy('month')
    setSalesReportError(null)
    try {
      const [y, m] = salesReportMonth.split('-').map(Number)
      const start = new Date(y, m - 1, 1)
      const end = new Date(y, m, 0)
      await downloadSalesPdf({
        start,
        end,
        title: `Reporte de ventas — ${salesReportMonth}`,
        fileSuffix: salesReportMonth,
      })
    } catch (err) {
      setSalesReportError(err instanceof Error ? err.message : 'Error generando el PDF')
    } finally {
      setSalesReportBusy(null)
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
    setPendienteError(null)
    try {
      await markPendientesPagados(ids)
      await loadPendientesRows()
    } catch (err) {
      setPendienteError(err instanceof Error ? err.message : 'Error marcando como pagado')
    } finally {
      setPayingId(null)
    }
  }

  async function handleDeletePendiente(id: string) {
    setPendienteError(null)
    try {
      const { error } = await supabase.from('ingreso_pendientes').delete().eq('id', id)
      if (error) throw error
      await loadPendientesRows()
    } catch (err) {
      setPendienteError(err instanceof Error ? err.message : 'Error eliminando el pendiente')
    }
  }

  async function handleAddFeriado(e: React.FormEvent) {
    e.preventDefault()
    if (!feriadoFecha || !feriadoNombre.trim()) {
      setFeriadoError('Ingresa la fecha y el nombre del feriado.')
      return
    }
    setFeriadoBusy(true)
    setFeriadoError(null)
    try {
      await addFeriado(feriadoFecha, feriadoNombre.trim(), feriadoTipo)
      setFeriadoFecha('')
      setFeriadoNombre('')
      setFeriadoTipo('feriado')
      await loadFeriadosRows()
    } catch (err) {
      setFeriadoError(err instanceof Error ? err.message : 'Error agregando el feriado')
    } finally {
      setFeriadoBusy(false)
    }
  }

  async function handleDeleteFeriado(id: string) {
    setDeletingFeriadoId(id)
    setFeriadoError(null)
    try {
      await deleteFeriado(id)
      await loadFeriadosRows()
    } catch (err) {
      setFeriadoError(err instanceof Error ? err.message : 'Error eliminando el feriado')
    } finally {
      setDeletingFeriadoId(null)
    }
  }

  const weeksInBonusMonth = getWeeksEndingInMonth(bonusMonth)

  const refreshAll = useCallback(() => {
    loadWorkers()
    loadRecords()
    loadLastStatuses()
    loadBonusRows()
    loadArqueoRows()
    loadWeeklySales()
    loadPendientesRows()
    loadDirectory()
    loadFeriadosRows()
    loadFeriadoExclusionsRows()
    loadExtensiones()
  }, [
    loadWorkers,
    loadRecords,
    loadLastStatuses,
    loadBonusRows,
    loadArqueoRows,
    loadWeeklySales,
    loadPendientesRows,
    loadDirectory,
    loadFeriadosRows,
    loadFeriadoExclusionsRows,
    loadExtensiones,
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

      <nav className="tab-nav">
        <button
          className={activeTab === 'trabajadores' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('trabajadores')}
        >
          Info trabajadores
        </button>
        <button
          className={activeTab === 'reportes' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('reportes')}
        >
          Reportes
        </button>
        <button
          className={activeTab === 'ventas' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('ventas')}
        >
          Ventas
        </button>
        <button
          className={activeTab === 'pedidos' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('pedidos')}
        >
          Pedidos
        </button>
        <button
          className={activeTab === 'pendientes' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('pendientes')}
        >
          Pendientes
        </button>
        <button
          className={activeTab === 'inventario' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('inventario')}
        >
          Inventario
        </button>
        <button
          className={activeTab === 'limpieza' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('limpieza')}
        >
          Limpieza
        </button>
        <button
          className={activeTab === 'registros' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setActiveTab('registros')}
        >
          Registros
        </button>
      </nav>

      {activeTab === 'trabajadores' && (
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
                  <button
                    className="btn btn-secondary btn-small"
                    disabled={
                      lastStatuses[w.id] === undefined ||
                      lastStatuses[w.id] === 'salida' ||
                      salidaBusyId === w.id
                    }
                    onClick={() => marcarSalidaManual(w.id)}
                    title="Usar solo si el trabajador olvidó marcar su salida"
                  >
                    {salidaBusyId === w.id ? 'Marcando...' : 'Marcar salida'}
                  </button>
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={() => {
                      setTiempoWorker(w)
                      setTiempoError(null)
                    }}
                    title="Evita que el sistema cierre la salida automática a la hora del horario"
                  >
                    + Tiempo{extensiones[w.id] ? ` (${extensiones[w.id]} min hoy)` : ''}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {editError && <p className="error-text">{editError}</p>}
        {salidaError && <p className="error-text">{salidaError}</p>}
        <p className="subtitle">
          La salida se marca sola a la hora de término del horario de cada trabajador. Usa
          &quot;+ Tiempo&quot; para autorizar horas extra de hoy.
        </p>
        {tiempoWorker && (
          <div className="camera-overlay">
            <div className="camera-modal">
              <h2>Sumar tiempo a {tiempoWorker.full_name}</h2>
              <p className="subtitle">
                Se suma a la hora de salida de hoy; hasta entonces el sistema no le cierra el turno.
              </p>
              <div className="action-row">
                {[30, 60, 90, 120].map((m) => (
                  <button
                    key={m}
                    className="btn btn-secondary"
                    disabled={tiempoBusy}
                    onClick={() => sumarTiempo(m)}
                  >
                    +{m >= 60 ? `${m / 60}h${m % 60 ? ' 30m' : ''}` : `${m} min`}
                  </button>
                ))}
              </div>
              <label>
                Otra cantidad (minutos)
                <input
                  type="number"
                  min={1}
                  value={tiempoCustom}
                  onChange={(e) => setTiempoCustom(e.target.value)}
                />
              </label>
              {tiempoError && <p className="error-text">{tiempoError}</p>}
              <div className="camera-actions">
                <button className="btn btn-secondary" onClick={() => setTiempoWorker(null)}>
                  Cerrar
                </button>
                <button
                  className="btn btn-primary"
                  disabled={tiempoBusy || !tiempoCustom}
                  onClick={() => sumarTiempo(Number(tiempoCustom))}
                >
                  Sumar
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
      )}

      {activeTab === 'reportes' && (
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
      )}

      {activeTab === 'trabajadores' && (
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
                  <table className="schedule-day-table">
                    <thead>
                      <tr>
                        <th>Día</th>
                        <th>Trabaja</th>
                        <th>Entrada</th>
                        <th>Salida</th>
                      </tr>
                    </thead>
                    <tbody>
                      {WEEKDAYS.map((d) => (
                        <tr key={d.value}>
                          <td>{d.label}</td>
                          <td>
                            <input
                              type="checkbox"
                              checked={scheduleForm.days[d.value].enabled}
                              onChange={() => toggleScheduleDay(d.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="time"
                              disabled={!scheduleForm.days[d.value].enabled}
                              value={scheduleForm.days[d.value].start}
                              onChange={(e) =>
                                updateScheduleDayTime(d.value, 'start', e.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="time"
                              disabled={!scheduleForm.days[d.value].enabled}
                              value={scheduleForm.days[d.value].end}
                              onChange={(e) =>
                                updateScheduleDayTime(d.value, 'end', e.target.value)
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={scheduleForm.weekly_bonus_eligible}
                      onChange={(e) =>
                        setScheduleForm(
                          (f) => f && { ...f, weekly_bonus_eligible: e.target.checked },
                        )
                      }
                    />
                    Participa en el bono de meta semanal ({formatCLP(WEEKLY_BONUS_AMOUNT)})
                  </label>
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
      )}

      {activeTab === 'ventas' && (
      <>
      <section className="card">
        <h2>Meta semanal de ventas</h2>
        <p className="subtitle">
          Semana {formatWeekLabel(getCurrentWeek())} · Meta: {formatCLP(WEEKLY_SALES_GOAL)}
        </p>
        <div className="goal-bar">
          <div
            className="goal-bar-fill"
            style={{ width: `${Math.min(100, Math.round((weeklySales / WEEKLY_SALES_GOAL) * 100))}%` }}
          />
        </div>
        <p>
          Venta de la semana (incluye deudas cobradas): <strong>{formatCLP(weeklySales)}</strong> (
          {Math.min(100, Math.round((weeklySales / WEEKLY_SALES_GOAL) * 100))}%)
        </p>
        <div className="report-row">
          <button
            className="btn btn-primary"
            onClick={handleDownloadWeeklySales}
            disabled={salesReportBusy !== null}
          >
            {salesReportBusy === 'week' ? 'Generando...' : 'Descargar PDF de esta semana'}
          </button>
          <label>
            Mes
            <input
              type="month"
              value={salesReportMonth}
              onChange={(e) => setSalesReportMonth(e.target.value)}
            />
          </label>
          <button
            className="btn btn-primary"
            onClick={handleDownloadMonthlySales}
            disabled={salesReportBusy !== null}
          >
            {salesReportBusy === 'month' ? 'Generando...' : 'Descargar PDF del mes'}
          </button>
        </div>
        {salesReportError && <p className="error-text">{salesReportError}</p>}
      </section>

      <section className="card">
        <div className="section-header">
          <h2>Arqueo diario</h2>
          <input type="date" value={arqueoDate} onChange={(e) => setArqueoDate(e.target.value)} />
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Trabajador</th>
              <th>Efectivo</th>
              <th>Débito</th>
              <th>Crédito</th>
              <th>Transferencia</th>
              <th>Venta total</th>
            </tr>
          </thead>
          <tbody>
            {arqueoRows.map((a) => (
              <tr key={a.id}>
                <td>{a.ingreso_profiles?.full_name ?? '—'}</td>
                <td>{formatCLP(a.efectivo)}</td>
                <td>{formatCLP(a.debito)}</td>
                <td>{formatCLP(a.credito)}</td>
                <td>{formatCLP(a.transferencia)}</td>
                <td>{formatCLP(ventaTotal(a))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>
                <strong>Venta bruta del día</strong>
              </td>
              <td>
                <strong>{formatCLP(arqueoRows.reduce((sum, a) => sum + ventaTotal(a), 0))}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </section>
      </>
      )}

      {activeTab === 'pedidos' && (
        <>
          <PedidosTienda />
          <HistorialPedidosTienda />
        </>
      )}

      {activeTab === 'inventario' && <InventarioAdmin />}

      {activeTab === 'limpieza' && <ReporteLimpieza workerId={profile.id} isAdmin />}

      {activeTab === 'pendientes' && (
      <section className="card">
        <h2>Pendientes (fiado)</h2>
        <p className="subtitle">
          Todos los trabajadores ven esta lista y pueden marcar como cobrado. Total pendiente:{' '}
          <strong>{formatCLP(totalPendiente(pendientes))}</strong>
        </p>
        {pendienteError && <p className="error-text">{pendienteError}</p>}
        <PendientesPorCliente
          pendientes={pendientes}
          nameDirectory={nameDirectory}
          busyKey={payingId}
          onCobrar={handleCobrar}
          onAbonar={handleAbonar}
          onEliminar={handleDeletePendiente}
        />
      </section>
      )}

      {activeTab === 'trabajadores' && (
      <section className="card">
        <h2>Feriados e irrenunciables</h2>
        <p className="subtitle">
          Feriado: {formatCLP(FERIADO_BONUS)} extra por día trabajado. Irrenunciable:{' '}
          {formatCLP(IRRENUNCIABLE_BONUS)} extra. Se suma solo si el trabajador realmente
          trabajó ese día. Si marcas a alguien en "No pagar a", no se le suma ese monto ese día
          aunque tenga un turno registrado (ej. si no fue o libró igual).
        </p>
        <form onSubmit={handleAddFeriado} className="worker-form">
          <label>
            Fecha
            <input
              type="date"
              value={feriadoFecha}
              onChange={(e) => setFeriadoFecha(e.target.value)}
            />
          </label>
          <label>
            Nombre
            <input
              value={feriadoNombre}
              onChange={(e) => setFeriadoNombre(e.target.value)}
              placeholder="Ej: Día de la Virgen del Carmen"
            />
          </label>
          <label>
            Tipo
            <select
              value={feriadoTipo}
              onChange={(e) => setFeriadoTipo(e.target.value as 'feriado' | 'irrenunciable')}
            >
              <option value="feriado">Feriado ({formatCLP(FERIADO_BONUS)})</option>
              <option value="irrenunciable">Irrenunciable ({formatCLP(IRRENUNCIABLE_BONUS)})</option>
            </select>
          </label>
          {feriadoError && <p className="error-text">{feriadoError}</p>}
          <button type="submit" className="btn btn-primary" disabled={feriadoBusy}>
            {feriadoBusy ? 'Guardando...' : 'Agregar feriado'}
          </button>
        </form>

        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Bono</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {feriados.map((f) => {
              const excludedCount = feriadoExclusions.filter((e) => e.fecha === f.fecha).length
              return (
                <tr key={f.id}>
                  <td>{f.fecha}</td>
                  <td>{f.nombre}</td>
                  <td>{f.tipo === 'irrenunciable' ? 'Irrenunciable' : 'Feriado'}</td>
                  <td>
                    {formatCLP(f.tipo === 'irrenunciable' ? IRRENUNCIABLE_BONUS : FERIADO_BONUS)}
                  </td>
                  <td>
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => setExclusionModalFeriado(f)}
                    >
                      No pagar a{excludedCount > 0 ? ` (${excludedCount})` : ''}
                    </button>
                  </td>
                  <td>
                    <button
                      className="btn btn-danger btn-small"
                      disabled={deletingFeriadoId === f.id}
                      onClick={() => handleDeleteFeriado(f.id)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {exclusionModalFeriado && (
          <div className="camera-overlay">
            <div className="camera-modal">
              <h2>No pagar a — {exclusionModalFeriado.nombre}</h2>
              <p className="subtitle">{exclusionModalFeriado.fecha}</p>
              {workers.map((w) => {
                const key = `${w.id}-${exclusionModalFeriado.fecha}`
                const excluded = feriadoExclusions.some(
                  (e) => e.worker_id === w.id && e.fecha === exclusionModalFeriado.fecha,
                )
                return (
                  <label key={w.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={excluded}
                      disabled={exclusionBusyKey === key}
                      onChange={() => toggleFeriadoExclusion(w.id, exclusionModalFeriado.fecha)}
                    />
                    {w.full_name}
                  </label>
                )
              })}
              <div className="camera-actions">
                <button className="btn btn-primary" onClick={() => setExclusionModalFeriado(null)}>
                  Listo
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
      )}

      {activeTab === 'reportes' && (
      <section className="card">
        <div className="section-header">
          <h2>Bono semanal ({formatCLP(WEEKLY_BONUS_AMOUNT)})</h2>
          <input type="month" value={bonusMonth} onChange={(e) => setBonusMonth(e.target.value)} />
        </div>
        <p className="subtitle">
          Las semanas van de lunes a domingo (el corte es el domingo). Una semana que empieza en
          el mes anterior se muestra en el mes de su domingo de cierre. Cada casilla suma{' '}
          {formatCLP(WEEKLY_BONUS_AMOUNT)}, y se marca sola al llegar la venta de esa semana a{' '}
          {formatCLP(WEEKLY_SALES_GOAL)} (puedes ajustarla igual a mano). Los trabajadores que no
          participan de este bono no aparecen aquí — se configura en "Horarios y sueldos".
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Trabajador</th>
              {weeksInBonusMonth.map((week) => (
                <th key={week.end.toISOString()}>Semana {formatWeekLabel(week)}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {workers.filter((w) => w.weekly_bonus_eligible).map((w) => {
              const earnedCount = weeksInBonusMonth.filter((week) =>
                isBonusEarned(w.id, week),
              ).length
              return (
                <tr key={w.id}>
                  <td>{w.full_name}</td>
                  {weeksInBonusMonth.map((week) => {
                    const key = `${w.id}-${week.end.toISOString()}`
                    return (
                      <td key={key}>
                        <input
                          type="checkbox"
                          checked={isBonusEarned(w.id, week)}
                          disabled={bonusBusyKey === key}
                          onChange={() => toggleBonus(w.id, week)}
                        />
                      </td>
                    )
                  })}
                  <td>{formatCLP(earnedCount * WEEKLY_BONUS_AMOUNT)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {bonusError && <p className="error-text">{bonusError}</p>}
      </section>
      )}

      {activeTab === 'registros' && (
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
      )}
      <AsistenteTienda />
    </div>
  )
}
