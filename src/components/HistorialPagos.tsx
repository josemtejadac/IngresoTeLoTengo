import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRealtimeRefresh } from '../lib/realtime'
import type { Profile } from '../types'
import { formatCLP } from '../lib/payroll'
import { formatHoursMinutes } from '../lib/hours'
import {
  loadPayHistory,
  loadWeekPayHistory,
  previousMonths,
  previousWeeks,
  type MonthPaySummary,
  type WeekPaySummary,
} from '../lib/payHistory'
import {
  loadPagosSueldo,
  marcarPagado,
  periodoMes,
  periodoSemana,
  quitarPago,
  urlCaptura,
  type PagoSueldo,
} from '../lib/pagosSueldo'

const MESES_A_MOSTRAR = 6
const SEMANAS_A_MOSTRAR = 8

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Pago del periodo. El admin lo marca: transferencia (adjunta la captura, que se sube muy comprimida) o efectivo.
 * Una vez marcado queda con el check verde de "Pagado"; el trabajador lo ve en su propio historial.
 */
function BloquePago({
  workerId,
  periodo,
  monto,
  pago,
  admin,
  onCambio,
}: {
  workerId: string
  periodo: string
  monto: number
  pago?: PagoSueldo
  admin: boolean
  onCambio: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ejecutar(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onCambio()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el pago')
    } finally {
      setBusy(false)
    }
  }

  async function verCaptura() {
    if (!pago?.comprobante_path) return
    try {
      window.open(await urlCaptura(pago.comprobante_path), '_blank', 'noopener')
    } catch {
      setError('No se pudo abrir la captura.')
    }
  }

  if (pago) {
    return (
      <div className="pago-sueldo pagado">
        <p>
          <span className="pago-check">✓</span> <strong>Pagado</strong> por{' '}
          {pago.metodo === 'transferencia' ? 'transferencia' : 'efectivo'} · {fechaHora(pago.pagado_at)}
          {pago.monto !== null && <> · {formatCLP(pago.monto)}</>}
        </p>
        <div className="pago-sueldo-acciones">
          {pago.comprobante_path && (
            <button type="button" className="btn-link" onClick={verCaptura}>
              Ver captura
            </button>
          )}
          {admin && (
            <button
              type="button"
              className="btn-link"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('¿Quitar la marca de pagado?')) return
                ejecutar(() => quitarPago(workerId, periodo, pago.comprobante_path))
              }}
            >
              Quitar pago
            </button>
          )}
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    )
  }

  if (!admin) return null

  return (
    <div className="pago-sueldo">
      <p className="subtitle">Marcar como pagado:</p>
      <div className="pago-sueldo-acciones">
        <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Subiendo...' : '📎 Transferencia (subir captura)'}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`¿Marcar ${formatCLP(monto)} como pagado en EFECTIVO?`)) return
            ejecutar(() => marcarPagado({ workerId, periodo, metodo: 'efectivo', monto }))
          }}
        >
          💵 Efectivo
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          e.target.value = ''
          if (archivo) ejecutar(() => marcarPagado({ workerId, periodo, metodo: 'transferencia', monto, captura: archivo }))
        }}
      />
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

/** Historial de sueldo de meses/semanas ya cerrados (todo lo que "Mi sueldo" mostraba mientras corria ese periodo). */
export function HistorialPagos({
  profile,
  selector,
  admin = false,
}: {
  profile: Profile
  selector?: ReactNode
  /** Solo el admin puede marcar pagos (transferencia con captura o efectivo). */
  admin?: boolean
}) {
  const esSemanal = profile.pay_frequency === 'weekly'
  const [meses, setMeses] = useState<MonthPaySummary[] | null>(null)
  const [semanas, setSemanas] = useState<WeekPaySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [pagos, setPagos] = useState<Record<string, PagoSueldo>>({})

  const cargarPagos = useCallback(() => {
    loadPagosSueldo(profile.id).then(setPagos).catch(() => {})
  }, [profile.id])

  const cargar = useCallback(() => {
    const falla = (err: unknown) => setError(err instanceof Error ? err.message : 'Error cargando el historial de pagos')
    if (esSemanal) {
      loadWeekPayHistory(profile, previousWeeks(SEMANAS_A_MOSTRAR)).then(setSemanas).catch(falla)
    } else {
      loadPayHistory(profile, previousMonths(MESES_A_MOSTRAR)).then(setMeses).catch(falla)
    }
    cargarPagos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, esSemanal, cargarPagos])

  // Carga al abrir (y al cambiar de trabajador), sin depender de la conexion en tiempo real.
  useEffect(() => {
    cargar()
  }, [cargar])

  // Se pone al dia sola: si una semana cumple la meta (el bono se marca solo), se ve en verde y se suma sin recargar.
  useRealtimeRefresh(['ingreso_weekly_bonus'], cargar, 60000)

  if (esSemanal) {
    const conDatos = (semanas ?? []).filter(
      (s) => s.pay.baseAmount > 0 || s.pay.overtimePay > 0 || s.weeklyBonusTotal > 0 || s.feriadoTotal > 0 || s.pay.tuesdayBonusTotal > 0,
    )
    return (
      <section className="card">
        <h2>Historial de pagos</h2>
        <p className="subtitle">
          El corte de cada semana es el domingo a las 12pm. Aquí queda el detalle de las semanas ya cerradas.
        </p>
        {selector}
        {error && <p className="error-text">{error}</p>}
        {!semanas && !error && <p className="subtitle">Cargando...</p>}
        {semanas && conDatos.length === 0 && <p className="subtitle">Todavía no hay semanas anteriores con datos.</p>}
        {conDatos.map((s) => (
          <div key={s.week.end.toISOString()} className="pago-mes">
            <button
              type="button"
              className="pago-mes-cabecera"
              onClick={() => setAbierto(abierto === s.label ? null : s.label)}
            >
              <strong>Semana {s.label}</strong>
              <span>
                {pagos[periodoSemana(s.week.start)] && <span className="pago-check-chip">✓ Pagado</span>}{' '}
                {formatCLP(s.total)} {abierto === s.label ? '▴' : '▾'}
              </span>
            </button>
            {abierto === s.label && (
              <div className="pago-mes-detalle">
                <p>
                  Sueldo base: <strong>{formatCLP(s.pay.baseAmount)}</strong> semanal
                </p>
                <p>
                  Horas extra: {formatHoursMinutes(s.pay.overtimeMs)} → <strong>{formatCLP(s.pay.overtimePay)}</strong>
                </p>
                {s.pay.tuesdayBonusCount > 0 && (
                  <p>
                    Bono martes: <strong>{formatCLP(s.pay.tuesdayBonusTotal)}</strong>
                  </p>
                )}
                {profile.weekly_bonus_eligible && (
                  <p>
                    Bono semanal: {s.weeklyBonusEarned ? 'meta cumplida' : 'meta no cumplida'} →{' '}
                    <strong>{formatCLP(s.weeklyBonusTotal)}</strong>
                  </p>
                )}
                {s.feriadoDays.length > 0 && (
                  <p>
                    Feriados/irrenunciables: {s.feriadoDays.map((d) => `${d.nombre} (${formatCLP(d.monto)})`).join(', ')} →{' '}
                    <strong>{formatCLP(s.feriadoTotal)}</strong>
                  </p>
                )}
                <p className="pago-mes-total">
                  Total de la semana: <strong>{formatCLP(s.total)}</strong>
                </p>
                <BloquePago
                  workerId={profile.id}
                  periodo={periodoSemana(s.week.start)}
                  monto={s.total}
                  pago={pagos[periodoSemana(s.week.start)]}
                  admin={admin}
                  onCambio={cargarPagos}
                />
              </div>
            )}
          </div>
        ))}
      </section>
    )
  }

  const conDatos = (meses ?? []).filter(
    (m) => m.pay.baseAmount > 0 || m.pay.overtimePay > 0 || m.weeklyBonusTotal > 0 || m.feriadoTotal > 0 || m.pay.tuesdayBonusTotal > 0,
  )

  return (
    <section className="card">
      <h2>Historial de pagos</h2>
      <p className="subtitle">
        Cuando termina el mes, &quot;Mi sueldo&quot; pasa solo al mes nuevo. Aquí queda el detalle de los meses
        anteriores.
      </p>
      {selector}
      {error && <p className="error-text">{error}</p>}
      {!meses && !error && <p className="subtitle">Cargando...</p>}
      {meses && conDatos.length === 0 && <p className="subtitle">Todavía no hay meses anteriores con datos.</p>}
      {conDatos.map((m) => (
        <div key={m.month} className="pago-mes">
          <button
            type="button"
            className="pago-mes-cabecera"
            onClick={() => setAbierto(abierto === m.month ? null : m.month)}
          >
            <strong>{m.label}</strong>
            <span>
              {pagos[periodoMes(m.month)] && <span className="pago-check-chip">✓ Pagado</span>}{' '}
              {formatCLP(m.total)} {abierto === m.month ? '▴' : '▾'}
            </span>
          </button>
          {abierto === m.month && (
            <div className="pago-mes-detalle">
              <p>
                Sueldo base: <strong>{formatCLP(m.pay.baseAmount)}</strong>
                {m.pay.payFrequency === 'monthly' ? ' mensual' : ' semanal'}
              </p>
              <p>
                Horas extra: {formatHoursMinutes(m.pay.overtimeMs)} → <strong>{formatCLP(m.pay.overtimePay)}</strong>
              </p>
              {m.pay.tuesdayBonusCount > 0 && (
                <p>
                  Bono martes: {m.pay.tuesdayBonusCount} → <strong>{formatCLP(m.pay.tuesdayBonusTotal)}</strong>
                </p>
              )}
              {profile.weekly_bonus_eligible && (
                <p>
                  Bono semanal: <strong>{formatCLP(m.weeklyBonusTotal)}</strong>
                  <span className="bonus-semanas">
                    {m.semanas.map((w) => (
                      <span
                        key={w.label}
                        className={w.earned ? 'bonus-week earned' : 'bonus-week'}
                        title={w.earned ? 'Meta cumplida' : 'Meta no cumplida (todavía)'}
                      >
                        {w.earned ? '✓ ' : ''}
                        {w.label}
                      </span>
                    ))}
                  </span>
                </p>
              )}
              {m.feriadoDays.length > 0 && (
                <p>
                  Feriados/irrenunciables: {m.feriadoDays.map((d) => `${d.nombre} (${formatCLP(d.monto)})`).join(', ')} →{' '}
                  <strong>{formatCLP(m.feriadoTotal)}</strong>
                </p>
              )}
              <p className="pago-mes-total">
                Total del mes: <strong>{formatCLP(m.total)}</strong>
              </p>
              <BloquePago
                workerId={profile.id}
                periodo={periodoMes(m.month)}
                monto={m.total}
                pago={pagos[periodoMes(m.month)]}
                admin={admin}
                onCambio={cargarPagos}
              />
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
