import { useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { loadVentasOnline, type VentaOnline } from '../lib/tienda'

interface Props {
  /** Dia en formato AAAA-MM-DD. */
  fecha: string
  /** Suma del arqueo del mismo dia, para mostrar el total con las ventas online. */
  arqueoTotal: number
  /** Solo el admin ve el detalle por trabajador. */
  esAdmin?: boolean
}

/** Ventas online (Flow) del dia: se suman solas al arqueo del trabajador que entrego el pedido. */
export function VentasOnlineDia({ fecha, arqueoTotal, esAdmin }: Props) {
  const [ventas, setVentas] = useState<VentaOnline[]>([])

  useEffect(() => {
    let vivo = true
    loadVentasOnline(fecha, fecha)
      .then((v) => vivo && setVentas(v))
      .catch(() => vivo && setVentas([]))
    return () => {
      vivo = false
    }
  }, [fecha])

  const totalOnline = ventas.reduce((sum, v) => sum + v.monto, 0)

  return (
    <div className="ventas-online">
      <h3>Ventas online (Flow) — automático</h3>
      {ventas.length === 0 ? (
        <p className="subtitle">Sin ventas online entregadas este día.</p>
      ) : (
        <>
          {esAdmin &&
            ventas.map((v) => (
              <p key={v.worker_id}>
                {v.nombre ?? '—'}: <strong>{formatCLP(v.monto)}</strong>
              </p>
            ))}
          <p>
            Online del día: <strong>{formatCLP(totalOnline)}</strong>
          </p>
        </>
      )}
      <p>
        Venta total con online: <strong>{formatCLP(arqueoTotal + totalOnline)}</strong>
      </p>
      <p className="subtitle">
        Se cuenta al trabajador que marca el pedido como entregado, en el día de la entrega.
      </p>
    </div>
  )
}
