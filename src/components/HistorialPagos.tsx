import { useEffect, useState } from 'react'
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

const MESES_A_MOSTRAR = 6
const SEMANAS_A_MOSTRAR = 8

/** Historial de sueldo de meses/semanas ya cerrados (todo lo que "Mi sueldo" mostraba mientras corria ese periodo). */
export function HistorialPagos({ profile }: { profile: Profile }) {
  const esSemanal = profile.pay_frequency === 'weekly'
  const [meses, setMeses] = useState<MonthPaySummary[] | null>(null)
  const [semanas, setSemanas] = useState<WeekPaySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    if (esSemanal) {
      loadWeekPayHistory(profile, previousWeeks(SEMANAS_A_MOSTRAR))
        .then((r) => vivo && setSemanas(r))
        .catch((err) => vivo && setError(err instanceof Error ? err.message : 'Error cargando el historial de pagos'))
    } else {
      loadPayHistory(profile, previousMonths(MESES_A_MOSTRAR))
        .then((r) => vivo && setMeses(r))
        .catch((err) => vivo && setError(err instanceof Error ? err.message : 'Error cargando el historial de pagos'))
    }
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, esSemanal])

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
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
