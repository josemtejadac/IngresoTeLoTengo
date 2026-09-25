import { useCallback, useEffect, useState } from 'react'
import { useRealtimeRefresh } from '../lib/realtime'
import { formatCLP } from '../lib/payroll'
import { loadAbonosDia, loadVentasPedidos, type AbonoDia, type VentaPedidos } from '../lib/tienda'

interface Props {
  /** Dia en formato AAAA-MM-DD. */
  fecha: string
  /** Suma del arqueo del mismo dia (ya incluye lo que la app sumo sola al entregar pedidos contra entrega). */
  arqueoTotal: number
  /** Solo el admin ve el detalle por trabajador. */
  esAdmin?: boolean
}

const ETIQUETA: Record<string, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
}

/**
 * Pedidos de la tienda del dia. Los pagados contra entrega (efectivo/debito/credito) ya estan sumados
 * dentro del arqueo (la app los agrega sola al marcarlos entregados); aca solo se muestran para que se
 * entienda de donde salen. El pago online (Flow) nunca pasa por el arqueo, asi que se suma aparte.
 */
export function VentasOnlineDia({ fecha, arqueoTotal, esAdmin }: Props) {
  const [ventas, setVentas] = useState<VentaPedidos[]>([])
  const [abonos, setAbonos] = useState<AbonoDia[]>([])

  const cargar = useCallback(() => {
    loadVentasPedidos(fecha, fecha)
      .then(setVentas)
      .catch(() => setVentas([]))
    loadAbonosDia(fecha)
      .then(setAbonos)
      .catch(() => setAbonos([]))
  }, [fecha])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Tiempo real: un pedido entregado o cancelado actualiza el bloque al instante.
  useRealtimeRefresh(['ingreso_pedidos_tienda', 'ingreso_abonos'], cargar)

  const online = ventas.filter((v) => v.metodo === 'online')
  const contraEntrega = ventas.filter((v) => v.metodo !== 'online')
  const totalOnline = online.reduce((sum, v) => sum + v.monto, 0)
  const totalContraEntrega = contraEntrega.reduce((sum, v) => sum + v.monto, 0)
  const totalAbonos = abonos.reduce((sum, a) => sum + a.monto, 0)
  // Los abonos con metodo ya estan dentro de las columnas del arqueo; solo los antiguos (sin metodo) se suman aparte.
  const abonosAparte = abonos.reduce((sum, a) => sum + a.monto_aparte, 0)

  return (
    <div className="ventas-online">
      <h3>Pedidos de la tienda del día — automático</h3>
      {ventas.length === 0 ? (
        <p className="subtitle">Sin pedidos de la tienda entregados este día.</p>
      ) : (
        <>
          {totalOnline > 0 && (
            <p>
              Pago online (Flow, se suma aparte del arqueo): <strong>{formatCLP(totalOnline)}</strong>
            </p>
          )}
          {totalContraEntrega > 0 && (
            <p className="subtitle">
              Contra entrega (ya incluido en el arqueo de abajo):{' '}
              {contraEntrega
                .reduce<{ m: string; monto: number }[]>((acc, v) => {
                  const existente = acc.find((x) => x.m === v.metodo)
                  if (existente) existente.monto += v.monto
                  else acc.push({ m: v.metodo, monto: v.monto })
                  return acc
                }, [])
                .map((x) => `${ETIQUETA[x.m] ?? x.m} ${formatCLP(x.monto)}`)
                .join(' · ')}
            </p>
          )}
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
        Arqueo del día (manual + pedidos contra entrega): <strong>{formatCLP(arqueoTotal)}</strong>
      </p>
      <p>
        Cobrado en abonos de deudas hoy: <strong>{formatCLP(totalAbonos)}</strong>
        {totalAbonos - abonosAparte > 0 && (
          <span className="subtitle"> (ya sumado en su columna del arqueo)</span>
        )}
      </p>
      {esAdmin && abonos.length > 0 && (
        <div className="subtitle">
          {abonos.map((a) => (
            <p key={a.worker_id}>
              {a.nombre ?? '—'} cobró {formatCLP(a.monto)} en abonos
            </p>
          ))}
        </div>
      )}
      <p>
        Venta total del día: <strong>{formatCLP(arqueoTotal + totalOnline + abonosAparte)}</strong>
      </p>
      <p className="subtitle">
        Un pedido contra entrega (efectivo, débito o crédito) se suma solo al arqueo del trabajador que lo marca
        como entregado, en la columna que corresponde. No lo anotes también a mano. El pago online (Flow) nunca pasa
        por caja, así que se muestra y se suma aparte.
      </p>
      <p className="subtitle">
        <strong>Ventas por fuera de la app</strong> (sin pedido en la tienda ni pedido manual) sí se anotan en tu
        arqueo a mano, como siempre. Los <strong>abonos de deudas</strong> (fiado) que cobras se suman solos al total del
        día: no los anotes en el arqueo.
      </p>
    </div>
  )
}
