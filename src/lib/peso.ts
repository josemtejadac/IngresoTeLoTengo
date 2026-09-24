/** Monto de un producto por peso: el precio guardado es por KILO, la cantidad va en gramos. */
export function montoPorPeso(precioKg: number, gramos: number): number {
  return Math.round((precioKg * gramos) / 1000)
}

export function formatGramos(gramos: number): string {
  if (gramos >= 1000) {
    return `${(gramos / 1000).toLocaleString('es-CL', { maximumFractionDigits: 2 })} kg`
  }
  return `${gramos} g`
}
