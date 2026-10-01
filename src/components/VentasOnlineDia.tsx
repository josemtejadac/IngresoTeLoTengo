import { useCallback, useEffect, useState } from 'react'
import { useRealtimeRefresh } from '../lib/realtime'
import { formatCLP } from '../lib/payroll'
import {
  loadAbonosDetalleDia,
  loadAbonosDia,
  loadVentasPedidos,
  type AbonoDetalle,
  type AbonoDia,
  type VentaPedidos,
} from '../lib/tienda'

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
  qr: 'QR',
  tarjeta: 'Tarjeta',
  mixto: 'Pago mixto',
}

function sumarPorMetodo<T>(filas: T[], metodo: (f: T) => string, monto: (f: T) => number) {
  return filas.reduce<{ m: string; monto: number }[]>((acc, f) => {
    const m = metodo(f)
    const existente = acc.find((x) => x.m === m)
    if (existente) existente.monto += monto(f)
    else acc.push({ m, monto: monto(f) })
    return acc
  }, [])
}

function textoPorMetodo(filas: { m: string; monto: number }[]) {
  return filas.map((x) => `${ETIQUETA[x.m] ?? x.m} ${formatCLP(x.monto)}`).join(' · ')
}

/**
 * Pedidos de la tienda del dia. Los pagados contra entrega (efectivo/debito/credito) ya estan sumados
 * dentro del arqueo (la app los agrega sola al marcarlos entregados); aca solo se muestran para que se
 * entienda de donde salen. El pago online (Flow) nunca pasa por el arqueo, asi que se suma aparte.
 */
export function VentasOnlineDia({ fecha, arqueoTotal, esAdmin }: Props) {
  const [ventas, setVentas] = useState<VentaPedidos[]>([])
  const [abonos, setAbonos] = useState<AbonoDia[]>([])
  const [detalleAbonos, setDetalleAbonos] = useState<AbonoDetalle[]>([])

  const cargar = useCallback(() => {
    loadVentasPedidos(fecha, fecha)
      .then(setVentas)
      .catch(() => setVentas([]))
    loadAbonosDia(fecha)
      .then(setAbonos)
      .catch(() => setAbonos([]))
    loadAbonosDetalleDia(fecha)
      .then(setDetalleAbonos)
      .catch(() => setDetalleAbonos([]))
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
  const contraEntregaPorMetodo = sumarPorMetodo(contraEntrega, (v) => v.metodo, (v) => v.monto)
  const abonosPorMetodo = sumarPorMetodo(detalleAbonos, (a) => a.metodo ?? 'sin método', (a) => a.monto)
  const ventaTotalDia = arqueoTotal + totalOnline + abonosAparte

  // Un trabajador por fila, combinando sus pedidos y sus abonos en una sola tarjeta (antes estaban en
  // dos bloques de texto separados, lo que confundia). Si no es admin, solo existe una fila: la propia.
  const idsTrabajadores = [...new Set([...ventas.map((v) => v.worker_id), ...abonos.map((a) => a.worker_id)])]
  const filasPorTrabajador = idsTrabajadores.map((id) => {
    const propiasVentas = ventas.filter((v) => v.worker_id === id)
    const propiasContraEntrega = propiasVentas.filter((v) => v.metodo !== 'online')
    const propioContraEntrega = propiasContraEntrega.reduce((s, v) => s + v.monto, 0)
    const propioContraEntregaPorMetodo = sumarPorMetodo(propiasContraEntrega, (v) => v.metodo, (v) => v.monto)
    const propioOnline = propiasVentas.filter((v) => v.metodo === 'online').reduce((s, v) => s + v.monto, 0)
    const propioAbono = abonos.find((a) => a.worker_id === id)
    const propioAbonoMonto = propioAbono?.monto ?? 0
    const propioAbonoDetalle = detalleAbonos.filter((d) => d.worker_id === id)
    const propioAbonoPorMetodo = sumarPorMetodo(propioAbonoDetalle, (d) => d.metodo ?? 'sin método', (d) => d.monto)
    const nombre = propiasVentas[0]?.nombre ?? propioAbono?.nombre ?? '—'
    return {
      id,
      nombre,
      contraEntrega: propioContraEntrega,
      contraEntregaPorMetodo: propioContraEntregaPorMetodo,
      online: propioOnline,
      abono: propioAbonoMonto,
      abonoPorMetodo: propioAbonoPorMetodo,
      // Lo que de verdad entra a su caja hoy (pedidos contra entrega + abonos cobrados).
      totalCaja: propioContraEntrega + propioAbonoMonto,
    }
  })

  if (ventas.length === 0 && detalleAbonos.length === 0) {
    return (
      <div className="ventas-online">
        <h3>Pedidos de la tienda del día — automático</h3>
        <p className="subtitle">Sin pedidos ni cobros de deudas este día.</p>
      </div>
    )
  }

  return (
    <div className="ventas-online">
      <h3>Pedidos de la tienda del día — automático</h3>

      {esAdmin && filasPorTrabajador.length > 0 && (
        <div className="ventas-trabajador-lista">
          {filasPorTrabajador.map((f) => (
            <div key={f.id} className="ventas-trabajador-card">
              <div className="ventas-trabajador-head">
                <strong>{f.nombre}</strong>
                <span className="ventas-trabajador-caja">
                  Entra a su caja: <strong>{formatCLP(f.totalCaja)}</strong>
                </span>
              </div>
              <div className="ventas-trabajador-filas">
                <div className="ventas-trabajador-fila">
                  <span>Contra entrega</span>
                  <span className="ventas-trabajador-monto">{formatCLP(f.contraEntrega)}</span>
                </div>
                {f.contraEntregaPorMetodo.length > 0 && (
                  <p className="subtitle ventas-trabajador-detalle">{textoPorMetodo(f.contraEntregaPorMetodo)}</p>
                )}
                {f.online > 0 && (
                  <div className="ventas-trabajador-fila">
                    <span>Online (Flow, no pasa por su caja)</span>
                    <span className="ventas-trabajador-monto">{formatCLP(f.online)}</span>
                  </div>
                )}
                {f.abono > 0 && (
                  <>
                    <div className="ventas-trabajador-fila">
                      <span>Abonos de deudas cobrados</span>
                      <span className="ventas-trabajador-monto">{formatCLP(f.abono)}</span>
                    </div>
                    {f.abonoPorMetodo.length > 0 && (
                      <p className="subtitle ventas-trabajador-detalle">{textoPorMetodo(f.abonoPorMetodo)}</p>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          <p className="subtitle">
            "Entra a su caja" = contra entrega + abonos cobrados (lo que debe coincidir con su arqueo). El pago
            online (Flow) nunca pasa por su caja, por eso no se suma ahí.
          </p>
        </div>
      )}

      <div className="ventas-resumen-bloque">
        <p className="ventas-resumen-titulo">📦 Pedidos de la tienda</p>
        {totalContraEntrega > 0 && (
          <p>
            Contra entrega (ya está en el arqueo de abajo): <strong>{formatCLP(totalContraEntrega)}</strong>
            {contraEntregaPorMetodo.length > 0 && (
              <>
                <br />
                <span className="subtitle">{textoPorMetodo(contraEntregaPorMetodo)}</span>
              </>
            )}
          </p>
        )}
        {totalOnline > 0 && (
          <p>
            Pago online, Flow (no pasa por caja, se suma aparte): <strong>{formatCLP(totalOnline)}</strong>
          </p>
        )}
      </div>

      {totalAbonos > 0 && (
        <div className="ventas-resumen-bloque">
          <p className="ventas-resumen-titulo">💳 Cobros de deudas (abonos)</p>
          <p>
            Cobrado hoy (ya está en el arqueo de abajo): <strong>{formatCLP(totalAbonos)}</strong>
          </p>
          {abonosPorMetodo.length > 0 && <p className="subtitle">{textoPorMetodo(abonosPorMetodo)}</p>}
          {detalleAbonos.length > 0 && (
            <>
              <p className="subtitle">Detalle (de dónde salió cada cobro):</p>
              {detalleAbonos.map((a) => (
                <p key={a.id} className="subtitle ventas-abono-detalle">
                  🕒 {new Date(a.hora).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                  <strong>{formatCLP(a.monto)}</strong> · {a.metodo ? (ETIQUETA[a.metodo] ?? a.metodo) : 'sin método'}{' '}
                  · deuda de {a.cliente ?? a.detalle ?? 'cliente sin nombre'}
                  {esAdmin && a.nombre ? ` · cobró ${a.nombre}` : ''}
                </p>
              ))}
            </>
          )}
        </div>
      )}

      <div className="ventas-resumen-bloque ventas-resumen-final">
        <p className="ventas-resumen-titulo">🧮 Resumen del día</p>
        <p>
          Arqueo (pedidos contra entrega + abonos cobrados): <strong>{formatCLP(arqueoTotal)}</strong>
        </p>
        <p>
          + Pago online, Flow: <strong>{formatCLP(totalOnline)}</strong>
        </p>
        <p className="ventas-resumen-total">
          = Venta total del día: <strong>{formatCLP(ventaTotalDia)}</strong>
        </p>
      </div>

      <p className="subtitle">
        Un pedido contra entrega (efectivo, débito o crédito) se suma solo al arqueo del trabajador que lo marca
        como entregado, en la columna que corresponde. No lo anotes también a mano. El pago online (Flow) nunca pasa
        por caja, así que se muestra y se suma aparte.
      </p>
      <p className="subtitle">
        <strong>Ventas por fuera de la app</strong> (sin pedido en la tienda ni pedido manual) sí se anotan en tu
        arqueo a mano, como siempre. Los <strong>abonos de deudas</strong> (fiado) que cobras se suman solos a tu
        arqueo: no los anotes ahí de nuevo.
      </p>
    </div>
  )
}
