import type { FiltroStock } from '../lib/inventario'

interface Props {
  value: FiltroStock
  onChange: (v: FiltroStock) => void
  cuentas: Record<FiltroStock, number>
}

const OPCIONES: { valor: FiltroStock; texto: string }[] = [
  { valor: 'todos', texto: 'Todos' },
  { valor: 'sinprecio', texto: 'Sin precio' },
  { valor: 'sinstock', texto: 'Sin stock' },
  { valor: 'bajostock', texto: 'Bajo stock' },
]

/** Filtro de productos segun precio y stock, para revisar rapido que falta reponer o tasar. */
export function FiltroStockBotones({ value, onChange, cuentas }: Props) {
  return (
    <div className="filtro-pago">
      {OPCIONES.map((o) => (
        <button
          key={o.valor}
          type="button"
          className={value === o.valor ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}
          onClick={() => onChange(o.valor)}
        >
          {o.texto} ({cuentas[o.valor]})
        </button>
      ))}
    </div>
  )
}
