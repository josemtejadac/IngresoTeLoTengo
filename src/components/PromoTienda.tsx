import { productoFotoUrl } from '../lib/inventario'
import { formatCLP } from '../lib/payroll'
import type { PromoTienda } from '../lib/tienda'
import { FotoImg } from './FotoImg'

/** Foto de una promo: la suya si tiene; si no, un collage con las fotos de los productos que incluye. */
export function PromoFoto({
  fotoPath,
  promo,
  nombre,
  precio,
  grande = false,
}: {
  fotoPath: string | null
  promo: PromoTienda
  nombre: string
  precio: number
  grande?: boolean
}) {
  const pct = ahorroPct(promo, precio)
  const fotos = promo.incluye.map((i) => i.foto_path).filter((f): f is string => !!f).slice(0, 4)
  return (
    <span className={grande ? 'promo-foto promo-foto-grande' : 'promo-foto'}>
      {fotoPath ? (
        <FotoImg src={productoFotoUrl(fotoPath)} alt={nombre} className="promo-foto-img" />
      ) : fotos.length > 0 ? (
        <span className={`promo-collage promo-collage-${fotos.length}`}>
          {fotos.map((f) => (
            <FotoImg key={f} src={productoFotoUrl(f)} alt="" className="promo-collage-img" />
          ))}
        </span>
      ) : (
        <span className="promo-collage promo-collage-vacio">🎁</span>
      )}
      <span className="promo-badge">🎁 PROMO</span>
      {pct !== null && <span className="promo-badge-pct">-{pct}%</span>}
    </span>
  )
}

/** Cuanto ahorra el cliente con la promo vs. comprar todo por separado (0 si no ahorra). */
export function ahorroPromo(promo: PromoTienda, precio: number): number {
  return Math.max(0, Math.round(promo.precio_separado - precio))
}

export function ahorroPct(promo: PromoTienda, precio: number): number | null {
  const ahorro = ahorroPromo(promo, precio)
  if (ahorro <= 0 || promo.precio_separado <= 0) return null
  return Math.round((ahorro / promo.precio_separado) * 100)
}

/** Linea corta para la tarjeta: "Ahorras $1.990" (o "3 productos" si no hay ahorro). */
export function resumenPromo(promo: PromoTienda, precio: number): string {
  const ahorro = ahorroPromo(promo, precio)
  if (ahorro > 0) return `Ahorras ${formatCLP(ahorro)}`
  const unidades = promo.incluye.reduce((s, i) => s + i.cantidad, 0)
  return `${unidades} producto${unidades === 1 ? '' : 's'}`
}

/** Lista de lo que incluye la promo, con la foto de cada producto (en el detalle). */
export function PromoIncluye({ promo }: { promo: PromoTienda }) {
  return (
    <div className="promo-incluye">
      <p className="promo-incluye-titulo">Esta promo incluye</p>
      <ul>
        {promo.incluye.map((i) => (
          <li key={i.nombre}>
            {i.foto_path ? (
              <FotoImg src={productoFotoUrl(i.foto_path)} alt="" className="promo-incluye-foto" />
            ) : (
              <span className="promo-incluye-foto promo-incluye-foto-vacia">🛒</span>
            )}
            <span className="promo-incluye-nombre">{i.nombre.toLowerCase()}</span>
            <span className="promo-incluye-cant">x{i.cantidad}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
