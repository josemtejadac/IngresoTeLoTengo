/**
 * Recorte de fondo en el propio dispositivo (gratis, sin enviar la foto a ningun servicio).
 * El modelo se descarga la primera vez (unos 40 MB) y queda guardado en el navegador.
 */
const CLAVE_INTENTO = 'tlt_recorte_intento'
const CLAVE_APAGADO = 'tlt_recorte_off'

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave)
  } catch {
    return null
  }
}

function escribir(clave: string, valor: string | null) {
  try {
    if (valor === null) localStorage.removeItem(clave)
    else localStorage.setItem(clave, valor)
  } catch {
    // sin almacenamiento: se sigue igual
  }
}

/**
 * Si un intento anterior nunca termino (la pagina se cerro o reinicio a mitad del
 * recorte, tipico de telefonos con poca memoria), se desactiva el recorte en este
 * dispositivo para que no siga cerrando la app. Se puede volver a activar a mano.
 */
export function revisarCaidaPrevia() {
  if (leer(CLAVE_INTENTO)) {
    escribir(CLAVE_APAGADO, '1')
    escribir(CLAVE_INTENTO, null)
  }
}

export function recorteActivo(): boolean {
  return leer(CLAVE_APAGADO) !== '1'
}

export function reactivarRecorte() {
  escribir(CLAVE_APAGADO, null)
  escribir(CLAVE_INTENTO, null)
}

/** Reduce la foto (los telefonos sacan fotos enormes que agotan la memoria al procesarlas). */
async function reducirFoto(file: File, maximo = 1024): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const escala = Math.min(1, maximo / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * escala))
  const h = Math.max(1, Math.round(bitmap.height * escala))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo procesar la imagen')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo reducir la imagen'))),
      'image/jpeg',
      0.9,
    )
  })
}

/**
 * Recorte de fondo en el propio dispositivo (gratis, sin enviar la foto a ningun servicio).
 * El modelo se descarga la primera vez (unos 40 MB) y queda guardado en el navegador.
 */
export async function quitarFondo(
  file: File,
  onProgreso?: (porcentaje: number) => void,
): Promise<Blob> {
  escribir(CLAVE_INTENTO, '1')
  try {
    const pequena = await reducirFoto(file)
    const { removeBackground } = await import('@imgly/background-removal')
    const correr = (device: 'gpu' | 'cpu') =>
      removeBackground(pequena, {
        model: 'isnet_quint8',
        device,
        output: { format: 'image/png' },
        progress: (_key: string, current: number, total: number) => {
          if (total > 0 && onProgreso) onProgreso(Math.min(100, Math.round((current / total) * 100)))
        },
      })
    // La tarjeta grafica (WebGPU) es rapida en computador, pero en muchos telefonos
    // cierra la pagina: alli se usa siempre el procesador, que es mas estable.
    const esMovil = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    if (!esMovil && 'gpu' in navigator) {
      try {
        return await correr('gpu')
      } catch {
        // sigue con cpu
      }
    }
    return await correr('cpu')
  } finally {
    escribir(CLAVE_INTENTO, null)
  }
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
