import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { compressImageFile } from '../lib/compressImage'
import { claveAlias, convertirCantidad, esKilo } from '../lib/facturaNombres'

interface Candidato {
  producto_id: string
  nombre: string
  stock: number
  activo: boolean
  por_peso: boolean
  gramos_unidad: number | null
  score: number
}

interface LineaLeida {
  n: number
  codigo: string
  nombre: string
  cantidad: number
  unidad: string
  precio_unitario: number
  por_codigo: boolean
  origen: 'aprendido' | 'codigo' | 'nombre'
  candidatos: Candidato[]
}

interface LineaEditable extends LineaLeida {
  /** producto elegido para sumar el stock ('' = no sumar) */
  elegido: string
  /** cantidad a sumar, en la unidad del producto (gramos si es por peso) */
  cantidadEditada: string
  nota: string
}

interface FormNuevo {
  nombre: string
  precio: string
  porPeso: boolean
  gramosUnidad: string
  categoria: string
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

function textoStock(c: Candidato): string {
  return c.por_peso ? `${c.stock} g` : String(c.stock)
}

/** Sube una factura (foto o PDF); la IA lee las lineas y, tras revisarlas, se suma el stock. */
export function FacturaStock({ onCerrar, onListo }: Props) {
  const [leyendo, setLeyendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [lineas, setLineas] = useState<LineaEditable[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)
  const [creando, setCreando] = useState<number | null>(null)
  const [form, setForm] = useState<FormNuevo>({ nombre: '', precio: '', porPeso: false, gramosUnidad: '', categoria: '' })
  const [creandoBusy, setCreandoBusy] = useState(false)

  async function leer(file: File) {
    setError(null)
    setResultado(null)
    setLineas(null)
    setCreando(null)
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
        leidas.map((l) => {
          const primero = l.candidatos[0]
          // Se preselecciona solo si ya se aprendio, el codigo coincide o el parecido es muy alto.
          const elegir = primero && (l.por_codigo || primero.score >= 0.8) ? primero : undefined
          const conv = convertirCantidad(l.cantidad, l.unidad, elegir)
          return {
            ...l,
            elegido: elegir ? elegir.producto_id : '',
            cantidadEditada: elegir ? String(conv.cantidad) : String(l.cantidad),
            nota: conv.nota,
          }
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer la factura')
    } finally {
      setLeyendo(false)
    }
  }

  function elegirProducto(n: number, productoId: string) {
    setLineas(
      (prev) =>
        prev &&
        prev.map((l) => {
          if (l.n !== n) return l
          const c = l.candidatos.find((x) => x.producto_id === productoId)
          const conv = convertirCantidad(l.cantidad, l.unidad, c)
          return { ...l, elegido: productoId, cantidadEditada: c ? String(conv.cantidad) : String(l.cantidad), nota: conv.nota }
        }),
    )
  }

  function cambiarCantidad(n: number, valor: string) {
    setLineas((prev) => prev && prev.map((l) => (l.n === n ? { ...l, cantidadEditada: valor } : l)))
  }

  function abrirCrear(l: LineaEditable) {
    setCreando(l.n)
    setError(null)
    setForm({
      nombre: l.nombre,
      precio: l.precio_unitario > 0 && !esKilo(l.unidad) ? '' : '',
      porPeso: esKilo(l.unidad),
      gramosUnidad: '',
      categoria: '',
    })
  }

  async function crearProducto(l: LineaEditable) {
    setCreandoBusy(true)
    setError(null)
    try {
      const gramosUnidad = form.porPeso && form.gramosUnidad ? Math.round(Number(form.gramosUnidad)) : null
      const { data, error: rpcError } = await supabase.rpc('ingreso_crear_producto_factura', {
        p_nombre: form.nombre,
        p_codigo: l.codigo.replace(/\D/g, '').length >= 8 ? l.codigo : '',
        p_precio: form.precio.trim() === '' ? null : Number(form.precio),
        p_por_peso: form.porPeso,
        p_gramos_unidad: gramosUnidad,
        p_categoria: form.categoria,
      })
      if (rpcError) throw rpcError
      const nuevo: Candidato = {
        producto_id: data as string,
        nombre: form.nombre.trim().toUpperCase(),
        stock: 0,
        activo: true,
        por_peso: form.porPeso,
        gramos_unidad: gramosUnidad,
        score: 1,
      }
      const conv = convertirCantidad(l.cantidad, l.unidad, nuevo)
      setLineas(
        (prev) =>
          prev &&
          prev.map((x) =>
            x.n === l.n
              ? { ...x, candidatos: [nuevo, ...x.candidatos], elegido: nuevo.producto_id, cantidadEditada: String(conv.cantidad), nota: conv.nota }
              : x,
          ),
      )
      setCreando(null)
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'No se pudo crear el producto'
      setError(msg)
    } finally {
      setCreandoBusy(false)
    }
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
      if (rpcError) {
        fallos.push(`${l.nombre}: ${rpcError.message}`)
        continue
      }
      ok++
      // La app aprende: la proxima vez esta linea de factura se reconoce sola.
      await supabase.rpc('ingreso_guardar_alias_factura', { p_clave: claveAlias(l.nombre), p_producto: l.elegido })
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
          sumar el stock. Lo que corriges aquí, la app lo recuerda para la próxima factura.
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
              ignoran: elígelo de la lista o créalo.
            </p>
            <div className="factura-lineas">
              {lineas.map((l) => {
                const elegido = l.candidatos.find((c) => c.producto_id === l.elegido)
                return (
                  <div key={l.n} className={l.elegido ? 'factura-linea' : 'factura-linea sin-elegir'}>
                    <div className="factura-linea-top">
                      <strong className="factura-nombre">{l.nombre}</strong>
                      <span className="subtitle">
                        Factura: {l.cantidad} {l.unidad || ''}
                      </span>
                    </div>
                    <select value={l.elegido} onChange={(e) => elegirProducto(l.n, e.target.value)}>
                      <option value="">— No sumar (elegir producto) —</option>
                      {l.candidatos.map((c) => (
                        <option key={c.producto_id} value={c.producto_id}>
                          {c.nombre} (stock {textoStock(c)}
                          {c.activo ? '' : ', oculto'}) {c.score >= 1 ? '· seguro' : `· ${Math.round(c.score * 100)}%`}
                        </option>
                      ))}
                    </select>
                    {l.elegido && (
                      <div className="factura-cantidad">
                        <span>Sumar:</span>
                        <input
                          type="number"
                          min={1}
                          value={l.cantidadEditada}
                          onChange={(e) => cambiarCantidad(l.n, e.target.value)}
                          className="qty-input"
                          aria-label="Cantidad a sumar"
                        />
                        <span>{elegido?.por_peso ? 'gramos' : 'unidades'}</span>
                      </div>
                    )}
                    {l.nota && <span className="subtitle">{l.nota}</span>}
                    {l.candidatos.length === 0 && creando !== l.n && (
                      <span className="subtitle">No lo encontré en tus productos.</span>
                    )}
                    {creando !== l.n ? (
                      <button type="button" className="btn-link" onClick={() => abrirCrear(l)}>
                        ➕ No es ninguno: crear producto nuevo
                      </button>
                    ) : (
                      <div className="factura-nuevo">
                        <label>
                          Nombre
                          <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={form.porPeso}
                            onChange={(e) => setForm({ ...form, porPeso: e.target.checked })}
                          />
                          Se vende por peso (el precio es por kilo)
                        </label>
                        <label>
                          {form.porPeso ? 'Precio por kilo ($)' : 'Precio de venta ($)'}
                          <input
                            type="number"
                            min={0}
                            value={form.precio}
                            onChange={(e) => setForm({ ...form, precio: e.target.value })}
                            placeholder="Puedes dejarlo vacío y ponerlo después"
                          />
                        </label>
                        {form.porPeso && (
                          <label>
                            Peso aproximado de 1 unidad (gramos, opcional)
                            <input
                              type="number"
                              min={1}
                              value={form.gramosUnidad}
                              onChange={(e) => setForm({ ...form, gramosUnidad: e.target.value })}
                              placeholder="Ej: 150 para un tomate"
                            />
                          </label>
                        )}
                        <label>
                          Categoría (opcional)
                          <input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} />
                        </label>
                        <div className="report-row">
                          <button type="button" className="btn btn-secondary btn-small" onClick={() => setCreando(null)}>
                            Cancelar
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            disabled={creandoBusy || form.nombre.trim().length < 2}
                            onClick={() => crearProducto(l)}
                          >
                            {creandoBusy ? 'Creando...' : 'Crear y usar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
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
