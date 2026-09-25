import { BAJO_STOCK_LIMITE, type FiltroStock } from '../lib/inventario'

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

const DESCRIPCION: Record<FiltroStock, string | null> = {
  todos: null,
  sinprecio: 'Productos que todavía no tienen precio: no se pueden vender hasta que les pongas uno.',
  sinstock: 'Productos agotados: tienen 0 unidades en stock.',
  bajostock: `Productos con ${BAJO_STOCK_LIMITE} o menos unidades en stock (pero más de 0): conviene reponerlos pronto.`,
}

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
      {DESCRIPCION[value] && <p className="filtro-descripcion">{DESCRIPCION[value]}</p>}
    </div>
  )
}
