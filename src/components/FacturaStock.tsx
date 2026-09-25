import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { compressImageFile } from '../lib/compressImage'

interface Candidato {
  producto_id: string
  nombre: string
  stock: number
  activo: boolean
  score: number
}

interface LineaLeida {
  n: number
  codigo: string
  nombre: string
  cantidad: number
  precio_unitario: number
  por_codigo: boolean
  candidatos: Candidato[]
}

interface LineaEditable extends LineaLeida {
  /** producto elegido para sumar el stock ('' = no sumar) */
  elegido: string
  cantidadEditada: string
}

interface Props {
  onCerrar: () => void
  /** Se llama al terminar de sumar, para refrescar el inventario. */
  onListo: () => void
}

function aBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(new Error('No se pudo leer el archivo'))
    r.readAsDataURL(blob)
  })
}

/** El admin sube una factura (foto o PDF); la IA lee las lineas y, tras revisarlas, se suma el stock. */
export function FacturaStock({ onCerrar, onListo }: Props) {
  const [leyendo, setLeyendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [lineas, setLineas] = useState<LineaEditable[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)

  async function leer(file: File) {
    setError(null)
    setResultado(null)
    setLineas(null)
    setLeyendo(true)
    try {
      let mime = file.type
      let blob: Blob = file
      if (mime.startsWith('image/')) {
        blob = await compressImageFile(file, 2000, 0.8)
        mime = 'image/jpeg'
      } else if (mime !== 'application/pdf') {
        throw new Error('Sube una foto o un PDF de la factura.')
      }
      if (blob.size > 5_500_000) throw new Error('El archivo es muy pesado (máx. ~5 MB).')
      const data = await aBase64(blob)
      const { data: res, error: fnError } = await supabase.functions.invoke('ingreso-leer-factura', {
        body: { mime, data },
      })
      if (fnError) {
        // El cuerpo del error trae el motivo real.
        const ctx = (fnError as { context?: Response }).context
        const detalle = ctx ? await ctx.json().catch(() => null) : null
        throw new Error(detalle?.error ?? fnError.message)
      }
      const leidas = (res as { lineas: LineaLeida[] }).lineas ?? []
      if (leidas.length === 0) throw new Error('No encontré productos en el archivo. Prueba con una foto más nítida.')
      setLineas(
        leidas.map((l) => ({
          ...l,
          // Se preselecciona solo si el codigo coincide o si el parecido es muy alto; lo demas lo elige el admin.
          elegido: l.candidatos[0] && (l.por_codigo || l.candidatos[0].score >= 0.75) ? l.candidatos[0].producto_id : '',
          cantidadEditada: String(l.cantidad),
        })),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer la factura')
    } finally {
      setLeyendo(false)
    }
  }

  function cambiar(n: number, campo: Partial<LineaEditable>) {
    setLineas((prev) => prev && prev.map((l) => (l.n === n ? { ...l, ...campo } : l)))
  }

  const seleccionadas = (lineas ?? []).filter((l) => l.elegido && Number(l.cantidadEditada) > 0)

  async function confirmar() {
    if (seleccionadas.length === 0) return
    if (!window.confirm(`¿Sumar el stock de ${seleccionadas.length} producto(s)?`)) return
    setGuardando(true)
    setError(null)
    let ok = 0
    const fallos: string[] = []
    for (const l of seleccionadas) {
      const { error: rpcError } = await supabase.rpc('ingreso_sumar_stock', {
        p_id: l.elegido,
        p_cantidad: Math.round(Number(l.cantidadEditada)),
      })
      if (rpcError) fallos.push(`${l.nombre}: ${rpcError.message}`)
      else ok++
    }
    setGuardando(false)
    setResultado(`Stock sumado en ${ok} producto(s).${fallos.length ? ` Con error: ${fallos.join('; ')}` : ''}`)
    setLineas(null)
    onListo()
  }

  return (
    <div className="camera-overlay">
      <div className="camera-modal manual-modal">
        <div className="modal-top">
          <button type="button" className="btn btn-secondary btn-small" onClick={onCerrar}>
            ← Cerrar
          </button>
          <h2>Cargar factura</h2>
        </div>
        <p className="subtitle">
          Sube una foto o el PDF de la factura. La app lee los productos y cantidades; tú revisas y confirmas antes de
          sumar el stock. Las cantidades se <strong>suman</strong> al stock actual y el producto queda activo.
        </p>

        {!lineas && (
          <label className="btn btn-primary">
            {leyendo ? 'Leyendo la factura...' : '📄 Elegir foto o PDF'}
            <input
              type="file"
              accept="image/*,application/pdf"
              hidden
              disabled={leyendo}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) leer(f)
                e.target.value = ''
              }}
            />
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        {resultado && <p className="info-text">{resultado}</p>}

        {lineas && (
          <>
            <p className="subtitle">
              {seleccionadas.length} de {lineas.length} línea(s) listas para sumar. Las que no tienen producto elegido se
              ignoran.
            </p>
            <div className="factura-lineas">
              {lineas.map((l) => (
                <div key={l.n} className={l.elegido ? 'factura-linea' : 'factura-linea sin-elegir'}>
                  <div className="factura-linea-top">
                    <strong className="factura-nombre">{l.nombre}</strong>
                    <input
                      type="number"
                      min={1}
                      value={l.cantidadEditada}
                      onChange={(e) => cambiar(l.n, { cantidadEditada: e.target.value })}
                      className="qty-input"
                      aria-label="Cantidad"
                    />
                  </div>
                  {l.codigo && <span className="subtitle">Código: {l.codigo}</span>}
                  <select value={l.elegido} onChange={(e) => cambiar(l.n, { elegido: e.target.value })}>
                    <option value="">— No sumar (elegir producto) —</option>
                    {l.candidatos.map((c) => (
                      <option key={c.producto_id} value={c.producto_id}>
                        {c.nombre} (stock {c.stock}
                        {c.activo ? '' : ', oculto'}) {c.score >= 1 ? '· código coincide' : `· ${Math.round(c.score * 100)}%`}
                      </option>
                    ))}
                  </select>
                  {l.candidatos.length === 0 && (
                    <span className="subtitle">Sin coincidencias: créalo o súmalo a mano en el inventario.</span>
                  )}
                </div>
              ))}
            </div>
            <div className="report-row">
              <button type="button" className="btn btn-secondary" onClick={() => setLineas(null)}>
                Subir otra
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={guardando || seleccionadas.length === 0}
                onClick={confirmar}
              >
                {guardando ? 'Sumando...' : `Sumar stock (${seleccionadas.length})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
