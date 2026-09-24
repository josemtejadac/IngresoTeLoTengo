/**
 * Recorte de fondo en el propio dispositivo (gratis, sin enviar la foto a ningun servicio).
 * El modelo se descarga la primera vez (unos 40 MB) y queda guardado en el navegador.
 */
export async function quitarFondo(
  file: File,
  onProgreso?: (porcentaje: number) => void,
): Promise<Blob> {
  const { removeBackground } = await import('@imgly/background-removal')
  const correr = (device: 'gpu' | 'cpu') =>
    removeBackground(file, {
      model: 'isnet_quint8',
      device,
      output: { format: 'image/png' },
      progress: (_key: string, current: number, total: number) => {
        if (total > 0 && onProgreso) onProgreso(Math.min(100, Math.round((current / total) * 100)))
      },
    })
  // Con tarjeta grafica (WebGPU) es bastante mas rapido; si falla, se usa el procesador.
  const tieneGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
  if (tieneGpu) {
    try {
      return await correr('gpu')
    } catch {
      // sigue con cpu
    }
  }
  return correr('cpu')
}

/** Encuadra el recorte (PNG con transparencia) centrado sobre un cuadrado blanco. */
export async function componerFondoBlanco(recorte: Blob, lado = 800): Promise<Blob> {
  const bitmap = await createImageBitmap(recorte)

  // Caja que contiene al producto (pixeles no transparentes), medida en una copia chica.
  const escala = Math.min(1, 300 / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * escala))
  const h = Math.max(1, Math.round(bitmap.height * escala))
  const chico = document.createElement('canvas')
  chico.width = w
  chico.height = h
  const cctx = chico.getContext('2d', { willReadFrequently: true })
  if (!cctx) throw new Error('No se pudo procesar la imagen')
  cctx.drawImage(bitmap, 0, 0, w, h)
  const { data } = cctx.getImageData(0, 0, w, h)
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 24) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error('No se detectó ningún producto en la foto')

  const sx = minX / escala
  const sy = minY / escala
  const sw = (maxX - minX + 1) / escala
  const sh = (maxY - minY + 1) / escala

  const canvas = document.createElement('canvas')
  canvas.width = lado
  canvas.height = lado
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo procesar la imagen')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, lado, lado)

  const util = lado * 0.88 // margen alrededor del producto
  const k = Math.min(util / sw, util / sh)
  const dw = sw * k
  const dh = sh * k
  ctx.drawImage(bitmap, sx, sy, sw, sh, (lado - dw) / 2, (lado - dh) / 2, dw, dh)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen'))),
      'image/jpeg',
      0.85,
    )
  })
}
