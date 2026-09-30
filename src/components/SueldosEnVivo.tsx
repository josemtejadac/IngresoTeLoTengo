import { useEffect, useState } from 'react'
import type { Profile } from '../types'
import { formatCLP } from '../lib/payroll'
import { formatHoursMinutes } from '../lib/hours'
import { currentMonthValue, loadMonthPaySummary, loadWeekPaySummary } from '../lib/payHistory'
import { getCurrentWeek } from '../lib/weeklyBonus'

interface Fila {
  worker: Profile
  periodo: string
  total: number
  baseAmount: number
  overtimeMs: number
  overtimePay: number
  tuesdayBonusTotal: number
  weeklyBonusTotal: number
  feriadoTotal: number
}

/**
 * Para que Xioyerlin sepa cuanto lleva de sueldo cada trabajador en tiempo real, en el periodo que
 * corresponde a cada quien: semana lunes-domingo en curso si cobra semanal (ej. Ricardo), mes en curso
 * si cobra mensual (ej. Darlin). Usa el mismo calculo que "Mi sueldo" del trabajador y el historial.
 */
export function SueldosEnVivo({ workers }: { workers: Profile[] }) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    const activos = workers.filter((w) => w.active)
    Promise.all(
      activos.map(async (w): Promise<Fila> => {
        if (w.pay_frequency === 'weekly') {
          const s = await loadWeekPaySummary(w, getCurrentWeek())
          return {
            worker: w,
            periodo: `Semana ${s.label} (en curso)`,
            total: s.total,
            baseAmount: s.pay.baseAmount,
            overtimeMs: s.pay.overtimeMs,
            overtimePay: s.pay.overtimePay,
            tuesdayBonusTotal: s.pay.tuesdayBonusTotal,
            weeklyBonusTotal: s.weeklyBonusTotal,
            feriadoTotal: s.feriadoTotal,
          }
        }
        const m = await loadMonthPaySummary(w, currentMonthValue())
        return {
          worker: w,
          periodo: `${m.label} (en curso)`,
          total: m.total,
          baseAmount: m.pay.baseAmount,
          overtimeMs: m.pay.overtimeMs,
          overtimePay: m.pay.overtimePay,
          tuesdayBonusTotal: m.pay.tuesdayBonusTotal,
          weeklyBonusTotal: m.weeklyBonusTotal,
          feriadoTotal: m.feriadoTotal,
        }
      }),
    )
      .then((r) => vivo && setFilas(r))
      .catch((err) => vivo && setError(err instanceof Error ? err.message : 'Error cargando sueldos'))
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workers])

  const totalGeneral = (filas ?? []).reduce((sum, f) => sum + f.total, 0)

  return (
    <section className="card">
      <h2>Sueldos en tiempo real</h2>
      <p className="subtitle">
        Cuánto lleva cada trabajador de sueldo en el periodo en curso (semana lunes-domingo si cobra semanal,
        mes si cobra mensual), para saber cuánto va a pagar.
      </p>
      {error && <p className="error-text">{error}</p>}
      {!filas && !error && <p className="subtitle">Cargando...</p>}
      {filas && filas.length === 0 && <p className="subtitle">No hay trabajadores activos.</p>}
      {filas && filas.length > 0 && (
        <>
          <ul className="worker-list">
            {filas.map((f) => (
              <li key={f.worker.id} className="schedule-item">
                <div>
                  <strong>{f.worker.full_name}</strong>{' '}
                  <span className="subtitle">· {f.periodo}</span>
                </div>
                <p className="subtitle">
                  Base {formatCLP(f.baseAmount)}
                  {f.overtimePay > 0 &&
                    ` · Extra ${formatHoursMinutes(f.overtimeMs)} (${formatCLP(f.overtimePay)})`}
                  {f.tuesdayBonusTotal > 0 && ` · Bono martes ${formatCLP(f.tuesdayBonusTotal)}`}
                  {f.weeklyBonusTotal > 0 && ` · Bono semanal ${formatCLP(f.weeklyBonusTotal)}`}
                  {f.feriadoTotal > 0 && ` · Feriados ${formatCLP(f.feriadoTotal)}`}
                </p>
                <p className="pago-mes-total">
                  Va llevando: <strong>{formatCLP(f.total)}</strong>
                </p>
              </li>
            ))}
          </ul>
          <p className="pago-mes-total">
            Total a pagar entre todos: <strong>{formatCLP(totalGeneral)}</strong>
          </p>
        </>
      )}
    </section>
  )
}
