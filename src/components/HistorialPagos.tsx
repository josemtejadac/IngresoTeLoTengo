import { useEffect, useState } from 'react'
import type { Profile } from '../types'
import { formatCLP } from '../lib/payroll'
import { formatHoursMinutes } from '../lib/hours'
import { loadPayHistory, previousMonths, type MonthPaySummary } from '../lib/payHistory'

const MESES_A_MOSTRAR = 6

/** Historial de sueldo de meses ya cerrados (todo lo que "Mi sueldo" mostraba mientras corria ese mes). */
export function HistorialPagos({ profile }: { profile: Profile }) {
  const [meses, setMeses] = useState<MonthPaySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    loadPayHistory(profile, previousMonths(MESES_A_MOSTRAR))
      .then((r) => vivo && setMeses(r))
      .catch((err) => vivo && setError(err instanceof Error ? err.message : 'Error cargando el historial de pagos'))
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

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
