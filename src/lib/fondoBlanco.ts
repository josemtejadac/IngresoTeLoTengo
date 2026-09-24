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

/** Dilatacion (o erosion) cuadrada de radio r sobre una mascara binaria. */
function morfologia(m: Uint8Array, w: number, h: number, r: number, dilatar: boolean): Uint8Array {
  const buscado = dilatar ? 1 : 0
  const tmp = new Uint8Array(m.length)
  const out = new Uint8Array(m.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = false
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w - 1, x + r)
      for (let xx = x0; xx <= x1 && !hit; xx++) if (m[y * w + xx] === buscado) hit = true
      tmp[y * w + x] = hit ? buscado : 1 - buscado
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h - 1, y + r)
    for (let x = 0; x < w; x++) {
      let hit = false
      for (let yy = y0; yy <= y1 && !hit; yy++) if (tmp[yy * w + x] === buscado) hit = true
      out[y * w + x] = hit ? buscado : 1 - buscado
    }
  }
  return out
}

/**
 * Convierte la mascara del recorte en una silueta solida y limpia: une huecos, rellena el
 * interior (plasticos transparentes, letras claras), borra restos de fondo sueltos y
 * suaviza el contorno.
 */
function limpiarMascara(alfa: Float32Array, w: number, h: number): Float32Array {
  const n = alfa.length
  let bin: Uint8Array = new Uint8Array(n)
  for (let i = 0; i < n; i++) bin[i] = alfa[i] >= 0.35 ? 1 : 0

  // 1) cierre: une zonas del producto separadas por pequenos huecos
  const r = Math.max(2, Math.round(Math.max(w, h) * 0.008))
  bin = morfologia(morfologia(bin, w, h, r, true), w, h, r, false)

  // 2) relleno de huecos: todo lo que no se alcanza desde el borde es interior del producto
  const fuera = new Uint8Array(n)
  const pila = new Int32Array(n)
  let tope = 0
  const sembrar = (i: number) => {
    if (bin[i] === 0 && fuera[i] === 0) {
      fuera[i] = 1
      pila[tope++] = i
    }
  }
  for (let x = 0; x < w; x++) {
    sembrar(x)
    sembrar((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    sembrar(y * w)
    sembrar(y * w + w - 1)
  }
  while (tope > 0) {
    const i = pila[--tope]
    const x = i % w
    const y = (i / w) | 0
    if (x > 0) sembrar(i - 1)
    if (x < w - 1) sembrar(i + 1)
    if (y > 0) sembrar(i - w)
    if (y < h - 1) sembrar(i + w)
  }
  for (let i = 0; i < n; i++) if (!fuera[i]) bin[i] = 1

  // 3) se queda con el objeto mas grande (y otros grandes): borra restos sueltos de fondo
  const etiqueta = new Int32Array(n)
  const areas: number[] = [0]
  let cuenta = 0
  for (let inicio = 0; inicio < n; inicio++) {
    if (bin[inicio] === 0 || etiqueta[inicio] !== 0) continue
    cuenta++
    tope = 0
    pila[tope++] = inicio
    etiqueta[inicio] = cuenta
    let area = 0
    while (tope > 0) {
      const i = pila[--tope]
      area++
      const x = i % w
      const y = (i / w) | 0
      const vecinos = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
      for (const v of vecinos) {
        if (v >= 0 && bin[v] === 1 && etiqueta[v] === 0) {
          etiqueta[v] = cuenta
          pila[tope++] = v
        }
      }
    }
    areas.push(area)
  }
  if (cuenta === 0) return new Float32Array(n)
  const mayor = Math.max(...areas)
  const final = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const e = etiqueta[i]
    if (e > 0 && areas[e] >= mayor * 0.15) final[i] = 1
  }

  // 4) contorno: se come 1 px (quita el reborde con color de fondo) y se difumina leve
  const erosionada = morfologia(final, w, h, 1, false)
  const salida = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let suma = 0
      let c = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && xx < w && yy >= 0 && yy < h) {
            suma += erosionada[yy * w + xx]
            c++
          }
        }
      }
      salida[y * w + x] = suma / c
    }
  }
  return salida
}

/** Encuadra el recorte (PNG con transparencia) centrado sobre un cuadrado blanco. */
export async function componerFondoBlanco(recorte: Blob, lado = 800): Promise<Blob> {
  const bitmap = await createImageBitmap(recorte)
  const w = bitmap.width
  const h = bitmap.height

  const origen = document.createElement('canvas')
  origen.width = w
  origen.height = h
  const octx = origen.getContext('2d', { willReadFrequently: true })
  if (!octx) throw new Error('No se pudo procesar la imagen')
  octx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const img = octx.getImageData(0, 0, w, h)
  const px = img.data

  const alfa = new Float32Array(w * h)
  for (let i = 0; i < alfa.length; i++) alfa[i] = px[i * 4 + 3] / 255
  const a = limpiarMascara(alfa, w, h)

  // Caja del producto sobre la mascara ya limpia, y composicion sobre blanco.
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const v = a[i]
      px[i * 4] = Math.round(px[i * 4] * v + 255 * (1 - v))
      px[i * 4 + 1] = Math.round(px[i * 4 + 1] * v + 255 * (1 - v))
      px[i * 4 + 2] = Math.round(px[i * 4 + 2] * v + 255 * (1 - v))
      px[i * 4 + 3] = 255
      if (v > 0.5) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error('No se detectó ningún producto en la foto')
  octx.putImageData(img, 0, 0)

  const sw = maxX - minX + 1
  const sh = maxY - minY + 1
  const canvas = document.createElement('canvas')
  canvas.width = lado
  canvas.height = lado
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo procesar la imagen')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, lado, lado)
  ctx.imageSmoothingQuality = 'high'

  const util = lado * 0.9 // margen alrededor del producto
  const k = Math.min(util / sw, util / sh)
  const dw = sw * k
  const dh = sh * k
  ctx.drawImage(origen, minX, minY, sw, sh, (lado - dw) / 2, (lado - dh) / 2, dw, dh)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen'))),
      'image/jpeg',
      0.9,
    )
  })
}
