import type { FiltroPago } from '../lib/tienda'

interface Props {
  value: FiltroPago
  onChange: (v: FiltroPago) => void
  cuentas: Record<FiltroPago, number>
}

const OPCIONES: { valor: FiltroPago; texto: string }[] = [
  { valor: 'todos', texto: 'Todos' },
  { valor: 'online', texto: 'Pago online' },
  { valor: 'contraentrega', texto: 'Contra entrega (efectivo / tarjeta)' },
]

/** Filtro de pedidos segun como pagaron: online (Flow) o contra entrega. */
export function FiltroPagoBotones({ value, onChange, cuentas }: Props) {
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
