interface Props {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number | null
  step?: number
  /** Texto que se muestra entre los botones (por defecto, el numero). */
  label?: string
}

/** Selector de cantidad con botones - y +. */
export function Stepper({ value, onChange, min = 1, max = null, step = 1, label }: Props) {
  const menos = () => onChange(Math.max(min, value - step))
  const mas = () => onChange(max !== null && max !== undefined ? Math.min(max, value + step) : value + step)
  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper-btn"
        onClick={menos}
        disabled={value <= min}
        aria-label="Menos"
      >
        −
      </button>
      <span className="stepper-valor">{label ?? value}</span>
      <button
        type="button"
        className="stepper-btn"
        onClick={mas}
        disabled={max !== null && max !== undefined && value >= max}
        aria-label="Más"
      >
        +
      </button>
    </div>
  )
}
