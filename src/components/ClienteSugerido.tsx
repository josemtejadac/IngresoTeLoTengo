import { useMemo, useState } from 'react'
import { formatCLP } from '../lib/payroll'

export interface ClienteOpcion {
  nombre: string
  /** Lo que debe hoy (0 si no tiene deudas pendientes). */
  deuda: number
}

interface Props {
  value: string
  onChange: (value: string) => void
  opciones: ClienteOpcion[]
  placeholder?: string
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Campo de cliente con sugerencias: al escribir parte del nombre o del depto
 * (ej. "202" o "juan") propone los clientes ya registrados, para no crear la
 * misma persona dos veces con distinta escritura.
 */
export function ClienteSugerido({ value, onChange, opciones, placeholder }: Props) {
  const [abierto, setAbierto] = useState(false)

  const sugeridos = useMemo(() => {
    const q = normalizar(value)
    if (!q) return []
    const palabras = q.split(' ')
    return opciones
      .filter((o) => {
        const n = normalizar(o.nombre)
        return n !== q && palabras.every((p) => n.includes(p))
      })
      .sort((a, b) => Number(b.deuda > 0) - Number(a.deuda > 0) || a.nombre.localeCompare(b.nombre))
      .slice(0, 6)
  }, [value, opciones])

  return (
    <div className="cliente-sugerido">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setAbierto(true)
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setAbierto(false)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {abierto && sugeridos.length > 0 && (
        <ul className="cliente-sugerencias">
          {sugeridos.map((o) => (
            <li key={o.nombre}>
              <button
                type="button"
                // onMouseDown para que el toque se registre antes de que el campo pierda el foco
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(o.nombre)
                  setAbierto(false)
                }}
              >
                <span>{o.nombre}</span>
                <span className="subtitle">{o.deuda > 0 ? `Debe ${formatCLP(o.deuda)}` : 'Sin deuda'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
