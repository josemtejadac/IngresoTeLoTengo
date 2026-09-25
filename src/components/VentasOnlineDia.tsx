import { useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { loadVentasPedidos, type VentaPedidos } from '../lib/tienda'

interface Props {
  /** Dia en formato AAAA-MM-DD. */
  fecha: string
  /** Suma del arqueo del mismo dia, para mostrar el total con los pedidos de la tienda. */
  arqueoTotal: number
  /** Solo el admin ve el detalle por trabajador. */
  esAdmin?: boolean
}

const ETIQUETA: Record<string, string> = {
  online: 'Pago online (Flow, ya pagado en la app)',
  efectivo: 'Pago en efectivo al recibir',
  tarjeta: 'Pago con tarjeta al recibir',
}

/** Ventas de pedidos de la tienda del dia: se suman solas al trabajador que marca el pedido como entregado. */
export function VentasOnlineDia({ fecha, arqueoTotal, esAdmin }: Props) {
  const [ventas, setVentas] = useState<VentaPedidos[]>([])

  useEffect(() => {
    let vivo = true
    loadVentasPedidos(fecha, fecha)
      .then((v) => vivo && setVentas(v))
      .catch(() => vivo && setVentas([]))
    return () => {
      vivo = false
    }
  }, [fecha])

  const total = ventas.reduce((sum, v) => sum + v.monto, 0)
  const porMetodo = (['online', 'efectivo', 'tarjeta'] as const).map((m) => ({
    m,
    monto: ventas.filter((v) => v.metodo === m).reduce((sum, v) => sum + v.monto, 0),
  }))

  return (
    <div className="ventas-online">
      <h3>Ventas de la tienda online (pedidos hechos en la app) — automático</h3>
      {ventas.length === 0 ? (
        <p className="subtitle">Sin pedidos de la tienda online entregados este día.</p>
      ) : (
        <>
          {porMetodo
            .filter((x) => x.monto > 0)
            .map((x) => (
              <p key={x.m}>
                {ETIQUETA[x.m]}: <strong>{formatCLP(x.monto)}</strong>
              </p>
            ))}
          {esAdmin && (
            <div className="subtitle">
              {[...new Set(ventas.map((v) => v.worker_id))].map((id) => {
                const propias = ventas.filter((v) => v.worker_id === id)
                return (
                  <p key={id}>
                    {propias[0].nombre ?? '—'}: {formatCLP(propias.reduce((sum, v) => sum + v.monto, 0))}
                  </p>
                )
              })}
            </div>
          )}
        </>
      )}
      <p>
        Arqueo del día (lo que anotan los trabajadores): <strong>{formatCLP(arqueoTotal)}</strong>
      </p>
      <p>
        Total pedidos de la tienda online entregados: <strong>{formatCLP(total)}</strong>
      </p>
      <p>
        Venta total del día: <strong>{formatCLP(arqueoTotal + total)}</strong>
      </p>
      <p className="subtitle">
        Son los pedidos que los clientes hicieron desde la tienda online (con pago online por Flow, o con efectivo/tarjeta al
        recibir). Se cuentan solos al trabajador que marca el pedido como entregado, según cómo pagó el cliente. No los
        anotes también en tu arqueo.
      </p>
      <p className="subtitle">
        <strong>Pedidos manuales:</strong> lo que vendas por fuera de la app (sin que el cliente use la tienda) sí se
        anota en tu arqueo, en efectivo, débito, crédito o transferencia, como siempre. Los pedidos manuales creados con
        el botón «+ Pedido manual» en Pedidos se cuentan solos al marcarlos como entregados.
      </p>
    </div>
  )
}
