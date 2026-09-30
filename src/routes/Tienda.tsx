import { useCallback, useEffect, useState } from 'react'
import { Logo } from '../components/Logo'
import { Stepper } from '../components/Stepper'
import { FotoImg } from '../components/FotoImg'
import { useRealtimeRefresh } from '../lib/realtime'
import { BotsitoCliente, type ItemBot } from '../components/BotsitoCliente'
import { NotificacionesPedidoCliente } from '../components/NotificacionesPedidoCliente'
import { useAtrasCierra } from '../lib/atras'
import { tiendaAbierta, TIENDA_ABRE_TEXTO, TIENDA_CIERRA_TEXTO } from '../lib/horarioTienda'
import { formatCLP } from '../lib/payroll'
import { formatGramos, montoPorPeso } from '../lib/peso'
import { guardarCliente, loadClienteGuardado, olvidarCliente } from '../lib/clienteGuardado'
import {
  crearPedidoTienda,
  cancelarPedidoCliente,
  guardarPedidoIdLocal,
  loadProductosPorIds,
  reactivarPedidoOnline,
  iniciarPagoFlow,
  loadMisPedidos,
  METODO_PAGO_LABEL,
  type MetodoPago,
  type MiPedido,
  loadCatalogoTienda,
  loadCategoriasTienda,
  productoFotoUrl,
  type ProductoTienda,
  type ProgresoPedido,
} from '../lib/tienda'

const PROGRESO_LABEL: Record<ProgresoPedido, string> = {
  recibido: '📥 Pedido recibido',
  preparando: '📦 Empacando tus productos',
  en_camino: '🛵 ¡Va en camino!',
}

/** Insignia bien visible del estado del pedido, para "Mis pedidos". */
function estadoPedidoBadge(p: MiPedido): { texto: string; clase: string } {
  if (p.estado === 'entregado') return { texto: '✅ Entregado', clase: 'pedido-badge pedido-badge-entregado' }
  if (p.estado === 'cancelado') {
    if (p.metodo_pago === 'online' && p.pago_estado !== 'pagado' && !p.cancelado_por_cliente) {
      return { texto: 'Pago no completado', clase: 'pedido-badge pedido-badge-cancelado' }
    }
    return {
      texto: p.cancelado_por_cliente ? 'Cancelado por ti' : 'Cancelado',
      clase: 'pedido-badge pedido-badge-cancelado',
    }
  }
  if (p.pago_estado === 'esperando_pago') return { texto: 'Sin pagar', clase: 'pedido-badge pedido-badge-pendiente' }
  const activo = p.progreso === 'preparando' || p.progreso === 'en_camino'
  return {
    texto: PROGRESO_LABEL[p.progreso] ?? PROGRESO_LABEL.recibido,
    clase: `pedido-badge pedido-badge-${p.progreso}${activo ? ' pedido-badge-activo' : ''}`,
  }
}

interface CartLine {
  producto: ProductoTienda
  /** Unidades normales, o (por peso) unidades aproximadas / gramos segun el modo; packs si esCombo. */
  cantidad: number
  modo?: 'unidades' | 'gramos'
  /** Se compra por pack (ej. 3 x $1000): cantidad son packs, no unidades sueltas. */
  esCombo?: boolean
}

function gramosLinea(l: CartLine): number {
  if (!l.producto.por_peso) return 0
  return l.modo === 'unidades' ? l.cantidad * (l.producto.gramos_unidad ?? 0) : l.cantidad
}

function totalLinea(l: CartLine): number {
  if (l.producto.por_peso) return montoPorPeso(l.producto.precio, gramosLinea(l))
  if (l.esCombo) return l.cantidad * (l.producto.combo_precio ?? 0)
  return l.producto.precio * l.cantidad
}

/** Los errores de Supabase no son instancias de Error: se lee su mensaje igual. */
function mensajeError(err: unknown, porDefecto: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return porDefecto
}

const GRAMOS_RAPIDOS = [100, 250, 500, 1000]

export function Tienda() {
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('')
  const [categorias, setCategorias] = useState<string[]>([])
  const [productos, setProductos] = useState<ProductoTienda[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [showCheckout, setShowCheckout] = useState(false)
  const [detalle, setDetalle] = useState<ProductoTienda | null>(null)
  const [detalleCant, setDetalleCant] = useState(1)
  const [pesoSel, setPesoSel] = useState<{
    producto: ProductoTienda
    modo: 'unidades' | 'gramos'
    valor: string
  } | null>(null)
  const [guardado, setGuardado] = useState(loadClienteGuardado)
  const [nombre, setNombre] = useState(guardado?.nombre ?? '')
  const [telefono, setTelefono] = useState(guardado?.telefono ?? '')
  const [torre, setTorre] = useState(guardado?.direcciones[guardado.ultima]?.torre ?? '')
  const [depto, setDepto] = useState(guardado?.direcciones[guardado.ultima]?.depto ?? '')
  // 'nueva' = escribir otra direccion; numero = indice de una direccion guardada
  const [dirSel, setDirSel] = useState<number | 'nueva'>(
    guardado && guardado.direcciones.length > 0 ? guardado.ultima : 'nueva',
  )
  const [guardarDatos, setGuardarDatos] = useState(true)
  const [email, setEmail] = useState(guardado?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sinConexion, setSinConexion] = useState(false)
  const [abierta, setAbierta] = useState(() => tiendaAbierta())

  // Revisa el horario cada 30s, para que la tienda se abra/cierre sola sin recargar la pagina.
  useEffect(() => {
    const t = setInterval(() => setAbierta(tiendaAbierta()), 30000)
    return () => clearInterval(t)
  }, [])
  const [confirmacion, setConfirmacion] = useState<{
    total: number
    pedidoId: string
    metodo: MetodoPago
  } | null>(null)
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo')
  const [pagoCon, setPagoCon] = useState('')
  const [verHistorial, setVerHistorial] = useState(false)
  // Vuelta desde Flow: ?pago=ok|pendiente|fallo&pedido=<id>
  const [retorno, setRetorno] = useState<{ pago: string; pedido: MiPedido | null } | null>(null)
  const [misPedidos, setMisPedidos] = useState<MiPedido[] | null>(null)

  // Con una ventana abierta, la pagina de atras no debe moverse al hacer scroll.
  const hayModal = showCheckout || detalle !== null || pesoSel !== null || verHistorial
  useEffect(() => {
    if (!hayModal) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [hayModal])

  useAtrasCierra(detalle !== null, () => setDetalle(null))
  useAtrasCierra(showCheckout, () => setShowCheckout(false))
  useAtrasCierra(pesoSel !== null, () => setPesoSel(null))
  useAtrasCierra(verHistorial, () => setVerHistorial(false))

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const pago = q.get('pago')
    const pedidoId = q.get('pedido')
    if (!pago || !pedidoId) return
    window.history.replaceState(null, '', window.location.pathname)
    let vivo = true
    let intentos = 0
    async function cargar() {
      try {
        const lista = await loadMisPedidos()
        const ped = lista.find((x) => x.id === pedidoId) ?? null
        if (!vivo) return
        setRetorno({ pago: ped?.pago_estado === 'pagado' ? 'ok' : (pago as string), pedido: ped })
        // Flow puede tardar unos segundos en avisar: se reintenta un rato.
        if (ped && ped.pago_estado === 'esperando_pago' && intentos++ < 12) setTimeout(cargar, 4000)
      } catch {
        if (vivo) setRetorno({ pago: pago as string, pedido: null })
      }
    }
    cargar()
    return () => {
      vivo = false
    }
  }, [])

  useEffect(() => {
    loadCategoriasTienda().then(setCategorias).catch(() => {})
  }, [])

  const runSearch = useCallback(async () => {
    try {
      const rows = await loadCatalogoTienda({
        search: search || undefined,
        categoria: categoria || undefined,
      })
      setProductos(rows)
      setSinConexion(false)
      setError(null)
    } catch (err) {
      // Sin internet (o el servidor no respondio): no se muestra como error fatal, se reintenta sola.
      setSinConexion(true)
    }
  }, [search, categoria])

  useEffect(() => {
    runSearch()
  }, [runSearch])

  // La app se defiende sola si se corta el internet: reintenta cada pocos segundos y de inmediato al volver la conexion.
  useEffect(() => {
    if (!sinConexion) return
    const t = setInterval(runSearch, 4000)
    const alVolver = () => runSearch()
    window.addEventListener('online', alVolver)
    return () => {
      clearInterval(t)
      window.removeEventListener('online', alVolver)
    }
  }, [sinConexion, runSearch])

  // Tiempo real: si un producto se agota o cambia de precio, el catalogo se actualiza solo.
  // El respaldo cada 30s cubre el caso en que la conexion en vivo se corte sin avisar.
  useRealtimeRefresh(['ingreso_productos'], runSearch, 30000)

  // Con "Mis pedidos" abierto, el estado (recibido/empacando/en camino/entregado) se actualiza solo,
  // sin que el cliente tenga que cerrar y volver a abrir.
  const recargarMisPedidos = useCallback(() => {
    if (!verHistorial) return
    loadMisPedidos().then(setMisPedidos).catch(() => {})
  }, [verHistorial])
  useRealtimeRefresh(['ingreso_pedidos_tienda'], recargarMisPedidos)

  // El detalle abierto de un producto tambien se actualiza en vivo (por si se agota mientras el cliente lo mira).
  useEffect(() => {
    if (!detalle) return
    const actualizado = productos.find((p) => p.id === detalle.id)
    if (actualizado && actualizado !== detalle) setDetalle(actualizado)
  }, [productos, detalle])

  function abrirPeso(producto: ProductoTienda) {
    const existente = cart.find((l) => l.producto.id === producto.id)
    const modo = existente?.modo ?? (producto.gramos_unidad ? 'unidades' : 'gramos')
    setPesoSel({
      producto,
      modo,
      valor: existente ? String(existente.cantidad) : modo === 'unidades' ? '1' : '250',
    })
  }

  function confirmarPeso() {
    if (!pesoSel) return
    const n = Math.round(Number(pesoSel.valor))
    const minimo = pesoSel.modo === 'gramos' ? 50 : 1
    if (!n || n < minimo) return
    setCart((prev) => [
      ...prev.filter((l) => l.producto.id !== pesoSel.producto.id),
      { producto: pesoSel.producto, cantidad: n, modo: pesoSel.modo },
    ])
    setPesoSel(null)
  }

  function enCarrito(productoId: string): number {
    return cart.find((l) => l.producto.id === productoId)?.cantidad ?? 0
  }

  function addToCart(producto: ProductoTienda, cantidad = 1) {
    if (producto.por_peso) {
      abrirPeso(producto)
      return
    }
    if (cart.some((l) => l.producto.id === producto.id && l.esCombo)) {
      setError(`Ya tienes ${producto.nombre} en pack en tu carrito. Quítalo antes de comprarlo por unidad.`)
      return
    }
    const max = producto.stock_max ?? Infinity
    if (enCarrito(producto.id) >= max) {
      setError(`Solo hay ${max} unidad(es) disponible(s) de ${producto.nombre}.`)
      return
    }
    setError(null)
    setCart((prev) => {
      const existing = prev.find((l) => l.producto.id === producto.id && !l.esCombo)
      if (existing) {
        return prev.map((l) =>
          l.producto.id === producto.id && !l.esCombo
            ? { ...l, cantidad: Math.min(max, l.cantidad + cantidad) }
            : l,
        )
      }
      return [...prev, { producto, cantidad: Math.min(max, cantidad) }]
    })
  }

  /** Agrega (o suma) un pack completo (ej. 3 x $1000) del producto, como linea aparte de la compra por unidad. */
  function agregarPack(producto: ProductoTienda) {
    if (!producto.combo_cantidad || !producto.combo_precio) return
    if (cart.some((l) => l.producto.id === producto.id && !l.esCombo)) {
      setError(`Ya tienes ${producto.nombre} por unidad en tu carrito. Quítalo antes de comprar el pack.`)
      return
    }
    const maxPacks = Math.floor((producto.stock_max ?? 0) / producto.combo_cantidad)
    if (maxPacks <= 0) {
      setError(`No hay stock suficiente para el pack de ${producto.nombre}.`)
      return
    }
    setError(null)
    setCart((prev) => {
      const existing = prev.find((l) => l.producto.id === producto.id && l.esCombo)
      if (existing) {
        return prev.map((l) =>
          l.producto.id === producto.id && l.esCombo ? { ...l, cantidad: Math.min(maxPacks, l.cantidad + 1) } : l,
        )
      }
      return [...prev, { producto, cantidad: 1, esCombo: true }]
    })
  }

  function abrirDetalle(producto: ProductoTienda) {
    setDetalle(producto)
    setDetalleCant(1)
  }

  function updateCantidad(productoId: string, cantidad: number) {
    setCart((prev) =>
      cantidad <= 0
        ? prev.filter((l) => l.producto.id !== productoId)
        : prev.map((l) => (l.producto.id === productoId ? { ...l, cantidad } : l)),
    )
  }

  function elegirDireccion(value: string) {
    if (value === 'nueva') {
      setDirSel('nueva')
      setTorre('')
      setDepto('')
      return
    }
    const idx = Number(value)
    setDirSel(idx)
    setTorre(guardado?.direcciones[idx]?.torre ?? '')
    setDepto(guardado?.direcciones[idx]?.depto ?? '')
  }

  function handleOlvidar() {
    olvidarCliente()
    setGuardado(null)
    setDirSel('nueva')
    setNombre('')
    setTelefono('')
    setEmail('')
    setTorre('')
    setDepto('')
  }

  const total = cart.reduce((sum, l) => sum + totalLinea(l), 0)
  const hayAprox = cart.some((l) => l.producto.por_peso && l.modo === 'unidades')
  // El peso real se sabe recien al pesar: con pago online no se puede cobrar ni devolver la diferencia.
  const hayPorPeso = cart.some((l) => l.producto.por_peso)

  // Si el total baja de $1.000 mientras se edita el carrito, no se puede dejar elegido debito/credito.
  useEffect(() => {
    if ((metodo === 'debito' || metodo === 'credito') && total < 1000) setMetodo('efectivo')
  }, [total, metodo])

  // Si se agrega un producto por peso mientras "online" estaba elegido, se cambia solo a efectivo.
  useEffect(() => {
    if (metodo === 'online' && hayPorPeso) setMetodo('efectivo')
  }, [metodo, hayPorPeso])

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault()
    if (cart.length === 0) return
    if (!tiendaAbierta()) {
      setError(`La tienda está cerrada. Recibimos pedidos de ${TIENDA_ABRE_TEXTO} a ${TIENDA_CIERRA_TEXTO}.`)
      return
    }
    if (metodo === 'online' && total < 350) {
      setError('El pago online requiere un mínimo de $350.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await crearPedidoTienda({
        nombre,
        telefono,
        torre,
        depto,
        metodo,
        pagoCon: metodo === 'efectivo' && pagoCon.trim() ? Number(pagoCon) : undefined,
        items: cart.map((l) => {
          if (l.producto.por_peso) {
            return l.modo === 'unidades'
              ? { producto_id: l.producto.id, unidades: l.cantidad }
              : { producto_id: l.producto.id, gramos: l.cantidad }
          }
          return { producto_id: l.producto.id, cantidad: l.cantidad, es_combo: l.esCombo || undefined }
        }),
      })
      if (guardarDatos) {
        guardarCliente({ nombre, telefono, email, torre, depto })
        const c = loadClienteGuardado()
        setGuardado(c)
        if (c) setDirSel(c.ultima)
      }
      guardarPedidoIdLocal(result.pedido_id)
      if (metodo === 'online') {
        // Se lleva al cliente a Flow; al pagar vuelve a la tienda con el pedido.
        window.location.href = await iniciarPagoFlow(result.pedido_id, email.trim())
        return
      }
      setConfirmacion({ total: result.total, pedidoId: result.pedido_id, metodo })
      setCart([])
      setShowCheckout(false)
      setPagoCon('')
      if (!guardarDatos) {
        setNombre('')
        setTelefono('')
        setTorre('')
        setDepto('')
      }
    } catch (err) {
      setError(mensajeError(err, 'Error generando el pedido'))
    } finally {
      setBusy(false)
    }
  }

  const [busyPedido, setBusyPedido] = useState<string | null>(null)

  async function pagarPedido(p: MiPedido) {
    let correo = email.trim()
    if (!correo) correo = (window.prompt('¿A qué correo te enviamos el comprobante de Flow?') ?? '').trim()
    if (!correo) return
    setBusyPedido(p.id)
    try {
      // Si el pedido ya vencio, se vuelve a reservar el stock antes de pagar.
      if (p.estado === 'cancelado') await reactivarPedidoOnline(p.id)
      window.location.href = await iniciarPagoFlow(p.id, correo)
    } catch (err) {
      setError(mensajeError(err, 'No se pudo iniciar el pago'))
      setBusyPedido(null)
    }
  }

  async function cancelarPedido(p: MiPedido) {
    if (!window.confirm('¿Cancelar este pedido? No se te cobrará nada.')) return
    setBusyPedido(p.id)
    try {
      await cancelarPedidoCliente(p.id)
      setMisPedidos(await loadMisPedidos())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar el pedido')
    } finally {
      setBusyPedido(null)
    }
  }

  /** Editar = cancelar el pedido sin pagar y devolver sus productos al carrito para agregar mas. */
  async function editarPedido(p: MiPedido) {
    const sinPagar = p.estado !== 'cancelado'
    if (
      sinPagar &&
      !window.confirm('Se cancela este pedido y sus productos vuelven a tu carrito para que puedas agregar más. ¿Seguimos?')
    ) {
      return
    }
    setBusyPedido(p.id)
    try {
      if (sinPagar) await cancelarPedidoCliente(p.id)
      const ids = p.items.map((it) => it.producto_id).filter((x): x is string => !!x)
      const prods = new Map((await loadProductosPorIds(ids)).map((x) => [x.id, x]))
      const lineas: CartLine[] = []
      let faltan = 0
      for (const it of p.items) {
        const prod = it.producto_id ? prods.get(it.producto_id) : undefined
        if (!prod) {
          faltan++
          continue
        }
        if (!prod.por_peso) {
          lineas.push({ producto: prod, cantidad: Math.min(it.cantidad, prod.stock_max ?? it.cantidad) })
        } else if (it.aprox && it.unidades) {
          lineas.push({ producto: prod, cantidad: it.unidades, modo: 'unidades' })
        } else {
          lineas.push({ producto: prod, cantidad: it.cantidad, modo: 'gramos' })
        }
      }
      setCart(lineas)
      setMetodo('online')
      setVerHistorial(false)
      setShowCheckout(true)
      setError(faltan > 0 ? `${faltan} producto(s) del pedido ya no están disponibles.` : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo editar el pedido')
    } finally {
      setBusyPedido(null)
    }
  }

  /** Agrega al carrito los productos que armo BotsitoMarket. */
  async function agregarDesdeBot(itemsBot: ItemBot[]) {
    const prods = new Map((await loadProductosPorIds(itemsBot.map((i) => i.producto_id))).map((x) => [x.id, x]))
    setCart((prev) => {
      let next = [...prev]
      for (const it of itemsBot) {
        const prod = prods.get(it.producto_id)
        if (!prod) continue
        if (prod.por_peso) {
          if (!it.gramos) continue
          next = [...next.filter((l) => l.producto.id !== prod.id), { producto: prod, cantidad: it.gramos, modo: 'gramos' }]
        } else {
          const max = prod.stock_max ?? Infinity
          const ex = next.find((l) => l.producto.id === prod.id)
          const cantidad = Math.min(max, (ex?.cantidad ?? 0) + (it.cantidad ?? 1))
          next = ex
            ? next.map((l) => (l.producto.id === prod.id ? { ...l, cantidad } : l))
            : [...next, { producto: prod, cantidad }]
        }
      }
      return next
    })
  }

  async function abrirHistorial() {
    setVerHistorial(true)
    setMisPedidos(null)
    try {
      setMisPedidos(await loadMisPedidos())
    } catch (err) {
      setMisPedidos([])
      setError(err instanceof Error ? err.message : 'Error cargando tus pedidos')
    }
  }

  if (retorno) {
    const ped = retorno.pedido
    const pagado = ped?.pago_estado === 'pagado'
    return (
      <div className="page-center">
        <div className={pagado ? 'card login-form retorno-pago' : 'card login-form'}>
          <div className="login-brand">
            <Logo size={72} />
            {pagado ? (
              <h1>¡Pago recibido!</h1>
            ) : retorno.pago === 'fallo' ? (
              <h1>Pago no completado</h1>
            ) : (
              <h1>Confirmando tu pago...</h1>
            )}
          </div>
          {pagado && (
            <p>
              <span className="badge-pagado">PAGADO</span> · Tu pedido está <strong>en curso</strong>. Te
              avisaremos cuando estemos en camino.
            </p>
          )}
          {!pagado && retorno.pago === 'fallo' && (
            <p>No se realizó el cobro. Tu pedido aparece en «Mis pedidos», desde ahí puedes volver a pedirlo.</p>
          )}
          {!pagado && retorno.pago !== 'fallo' && (
            <p className="subtitle">Estamos esperando la confirmación de Flow. Esto tarda unos segundos.</p>
          )}
          {ped && (
            <p className="subtitle">
              Total: <strong>{formatCLP(ped.total)}</strong> ·{' '}
              {ped.items
                .map((it) =>
                  it.es_peso ? `${it.nombre_producto} (${formatGramos(it.cantidad)})` : `${it.cantidad}x ${it.nombre_producto}`,
                )
                .join(', ')}
            </p>
          )}
          <button className="btn btn-primary" onClick={() => setRetorno(null)}>
            Volver a la tienda
          </button>
        </div>
      </div>
    )
  }

  if (confirmacion) {
    return (
      <div className="page-center">
        <div className="card login-form">
          <div className="login-brand">
            <Logo size={72} />
            <h1>¡Pedido recibido!</h1>
          </div>
          <p className="subtitle">
            Total: <strong>{formatCLP(confirmacion.total)}</strong> · Pago:{' '}
            {METODO_PAGO_LABEL[confirmacion.metodo]} al recibir
          </p>
          <p>Te avisaremos cuando estemos en camino.</p>
          <NotificacionesPedidoCliente pedidoId={confirmacion.pedidoId} />
          <div className="report-row">
            <button className="btn btn-primary" onClick={() => setConfirmacion(null)}>
              Hacer otro pedido
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setConfirmacion(null)
                abrirHistorial()
              }}
            >
              Ver estado de mi pedido
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="tienda-hero">
        <div className="tienda-hero-top">
          <div className="brand-row">
            <Logo size={52} />
            <div>
              <h1>Te Lo Tengo Market</h1>
              <p>Delivery dentro del condominio</p>
            </div>
          </div>
          <div className="tienda-hero-botones">
            <button className="tienda-pedidos-btn" onClick={abrirHistorial}>
              🧾 Mis pedidos
            </button>
            <a
              className="tienda-wsp"
              href="https://wa.me/56971605299?text=Hola%2C%20necesito%20ayuda%20con%20la%20tienda"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Soporte por WhatsApp"
              title="Soporte por WhatsApp"
            >
              <svg viewBox="0 0 32 32" width="22" height="22" fill="currentColor" aria-hidden="true">
                <path d="M16.04 3C9.4 3 4 8.4 4 15.04c0 2.12.55 4.19 1.6 6.02L4 29l8.1-1.57a12 12 0 0 0 3.94.66C22.68 28.1 28 22.7 28 16.06 28 9.4 22.68 3 16.04 3zm0 22.1c-1.27 0-2.5-.34-3.6-.98l-.26-.15-4.8.93.95-4.68-.17-.27a9.9 9.9 0 0 1-1.5-5.2c0-5.5 4.47-9.97 9.98-9.97s9.98 4.47 9.98 9.97-4.47 9.35-9.98 9.35zm5.47-7.4c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.5-1.78-1.67-2.08-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.2 5.08 4.5.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z" />
              </svg>
            </a>
          </div>
        </div>
        <div className="tienda-beneficios">
          <span>🚚 Te lo llevamos a tu depto</span>
          <span>💳 Paga online o al recibir</span>
          <span>🕒 Atendemos de {TIENDA_ABRE_TEXTO} a {TIENDA_CIERRA_TEXTO}</span>
        </div>
        <input
          type="search"
          className="tienda-buscar"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍  ¿Qué necesitas? Ej: coca cola"
          aria-label="Buscar producto"
        />
      </header>

      {sinConexion && (
        <p className="conexion-aviso">📶 Sin conexión. Reintentando solo, un momento...</p>
      )}
      {error && <p className="error-text">{error}</p>}

      <div className="tienda-chips-wrap">
        <div className="tienda-chips" role="tablist" aria-label="Categorías">
          <button
            type="button"
            className={categoria === '' ? 'tienda-chip activo' : 'tienda-chip'}
            onClick={() => setCategoria('')}
          >
            Todas
          </button>
          {categorias.map((c) => (
            <button
              key={c}
              type="button"
              className={categoria === c ? 'tienda-chip activo' : 'tienda-chip'}
              onClick={() => setCategoria(c)}
            >
              {c.replace(/\s+/g, ' ').trim().toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {!abierta && (
        <div className="tienda-cerrada-aviso">
          🔒 Tienda cerrada. Recibimos pedidos de {TIENDA_ABRE_TEXTO} a {TIENDA_CIERRA_TEXTO}. ¡Vuelve pronto!
        </div>
      )}

      {productos.length === 0 && !sinConexion && <p className="subtitle">No encontramos productos con esa búsqueda.</p>}

      <div className={abierta ? 'tienda-grid' : 'tienda-grid tienda-grid-cerrada'}>
        {productos.map((p) => (
          <div key={p.id} className={p.disponible ? 'tienda-card' : 'tienda-card sin-stock'}>
            <button type="button" className="tienda-abrir" onClick={() => abrirDetalle(p)}>
              {p.foto_path ? (
                <FotoImg src={productoFotoUrl(p.foto_path)} alt={p.nombre} className="tienda-foto" />
              ) : (
                <div className="tienda-foto tienda-foto-placeholder">🛒</div>
              )}
              {!p.disponible && <span className="tienda-agotado">Sin stock</span>}
              {p.descuento_pct && <span className="tienda-descuento-badge">-{p.descuento_pct}%</span>}
              <p className="tienda-nombre">{p.nombre}</p>
            </button>
            <p className="tienda-precio">
              {p.precio_original && (
                <span className="tienda-precio-original">{formatCLP(p.precio_original)}</span>
              )}
              <span className={p.precio_original ? 'tienda-precio-descuento' : undefined}>
                {formatCLP(p.precio)}
                {p.por_peso ? ' /kg' : ''}
              </span>
            </p>
            {p.nota && <p className="tienda-nota-chica">📌 {p.nota}</p>}
            <button
              className="btn btn-primary btn-small"
              disabled={!p.disponible || !abierta}
              onClick={() => addToCart(p)}
            >
              {!abierta ? 'Tienda cerrada' : p.disponible ? '+ Agregar' : 'Sin stock'}
            </button>
          </div>
        ))}
      </div>

      {abierta && (
        <BotsitoCliente
          hayCarrito={cart.length > 0}
          onAgregar={agregarDesdeBot}
          onVerCarrito={() => setShowCheckout(true)}
        />
      )}

      {abierta && cart.length > 0 && (
        <div className="tienda-cart-bar">
          <span>
            {cart.length} producto(s) · {hayAprox ? '≈ ' : ''}
            {formatCLP(total)}
          </span>
          <button className="btn btn-primary" onClick={() => setShowCheckout(true)}>
            Ver pedido
          </button>
        </div>
      )}

      {showCheckout && (
        <div className="camera-overlay">
          <div className="camera-modal">
            <div className="modal-top">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setShowCheckout(false)}>
                ← Volver
              </button>
              <h2>Tu pedido</h2>
            </div>
            <div className="carrito-lista">
              {cart.map((l) => (
                <div key={l.producto.id} className="carrito-item">
                  <button
                    type="button"
                    className="carrito-quitar"
                    aria-label={`Quitar ${l.producto.nombre}`}
                    title="Quitar del carrito"
                    onClick={() => updateCantidad(l.producto.id, 0)}
                  >
                    ✕
                  </button>
                  {l.producto.foto_path ? (
                    <FotoImg src={productoFotoUrl(l.producto.foto_path)} className="carrito-foto" />
                  ) : (
                    <div className="carrito-foto carrito-foto-vacia">🛒</div>
                  )}
                  <div className="carrito-info">
                    <p className="carrito-nombre">
                      {l.producto.nombre}
                      {l.esCombo && ` · pack x${l.producto.combo_cantidad}`}
                    </p>
                    <p className="carrito-precio">
                      {l.producto.por_peso && l.modo === 'unidades' ? '≈ ' : ''}
                      {formatCLP(totalLinea(l))}
                    </p>
                    <div className="carrito-acciones">
                      {l.producto.por_peso ? (
                        <button type="button" className="btn btn-secondary btn-small" onClick={() => abrirPeso(l.producto)}>
                          {l.modo === 'unidades'
                            ? `${l.cantidad} un (≈ ${formatGramos(gramosLinea(l))})`
                            : formatGramos(l.cantidad)}{' '}
                          · Cambiar
                        </button>
                      ) : l.esCombo ? (
                        <Stepper
                          value={l.cantidad}
                          min={1}
                          max={Math.floor((l.producto.stock_max ?? 0) / (l.producto.combo_cantidad ?? 1))}
                          label={`${l.cantidad} pack(s)`}
                          onChange={(v) => updateCantidad(l.producto.id, v)}
                        />
                      ) : (
                        <Stepper
                          value={l.cantidad}
                          min={1}
                          max={l.producto.stock_max}
                          onChange={(v) => updateCantidad(l.producto.id, v)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {cart.length === 0 && <p className="subtitle">Tu carrito está vacío.</p>}
            </div>
            <p>
              Total: <strong>{hayAprox ? '≈ ' : ''}{formatCLP(total)}</strong>
            </p>
            {hayAprox && (
              <p className="subtitle">
                Lo pedido por unidad es aproximado: se pesa al armar tu pedido y el valor final se
                ajusta al peso real.
              </p>
            )}

            <form onSubmit={handleCheckout} className="worker-form">
              <label>
                Nombre
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
              </label>
              <label>
                Teléfono (WhatsApp)
                <input
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="+56 9 1234 5678"
                  required
                />
              </label>
              {guardado && guardado.direcciones.length > 0 && (
                <label>
                  Dirección de entrega
                  <select value={String(dirSel)} onChange={(e) => elegirDireccion(e.target.value)}>
                    {guardado.direcciones.map((d, i) => (
                      <option key={i} value={i}>
                        Torre {d.torre}, depto {d.depto}
                      </option>
                    ))}
                    <option value="nueva">Otra dirección…</option>
                  </select>
                </label>
              )}
              {dirSel === 'nueva' && (
                <>
                  <label>
                    Torre
                    <input value={torre} onChange={(e) => setTorre(e.target.value)} required />
                  </label>
                  <label>
                    Depto
                    <input value={depto} onChange={(e) => setDepto(e.target.value)} required />
                  </label>
                </>
              )}
              {metodo === 'online' && (
                <label>
                  Correo (Flow te envía el comprobante)
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tucorreo@ejemplo.com"
                    required
                  />
                </label>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={guardarDatos}
                  onChange={(e) => setGuardarDatos(e.target.checked)}
                />
                Guardar mis datos para la próxima vez
              </label>
              {guardado && (
                <button type="button" className="btn-link" onClick={handleOlvidar}>
                  Borrar mis datos guardados
                </button>
              )}
              <fieldset className="pago-metodos">
                <legend>¿Cómo pagas?</legend>
                {(['efectivo', 'debito', 'credito'] as MetodoPago[]).map((m) => {
                  const bloqueado = (m === 'debito' || m === 'credito') && total < 1000
                  return (
                    <label key={m} className={bloqueado ? 'checkbox-label pago-disabled' : 'checkbox-label'}>
                      <input
                        type="radio"
                        name="metodo"
                        checked={metodo === m}
                        disabled={bloqueado}
                        onChange={() => setMetodo(m)}
                      />
                      {METODO_PAGO_LABEL[m]} al recibir
                    </label>
                  )
                })}
                {metodo === 'efectivo' && (
                  <label className="chat-input">
                    ¿Con cuánto vas a pagar? (opcional, para que te lleven el vuelto listo)
                    <input
                      type="number"
                      min={0}
                      value={pagoCon}
                      onChange={(e) => setPagoCon(e.target.value)}
                      placeholder={`Ej: ${formatCLP(Math.ceil(total / 1000) * 1000)}`}
                    />
                  </label>
                )}
                {total < 1000 && (
                  <p className="subtitle">
                    Con menos de $1.000 solo se puede pagar en efectivo o con pago online.
                  </p>
                )}
                <label className={hayPorPeso ? 'checkbox-label pago-disabled' : 'checkbox-label'}>
                  <input
                    type="radio"
                    name="metodo"
                    checked={metodo === 'online'}
                    disabled={hayPorPeso}
                    onChange={() => setMetodo('online')}
                  />
                  Pago online (Flow) — tarjeta o transferencia
                </label>
                {hayPorPeso && (
                  <p className="subtitle">
                    Tu pedido tiene productos por peso (se pesan al entregar): con esos solo se puede pagar al
                    recibir.
                  </p>
                )}
              </fieldset>
              {error && <p className="error-text">{error}</p>}
              <div className="report-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCheckout(false)}
                >
                  Seguir comprando
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Enviando...' : metodo === 'online' ? 'Ir a pagar' : 'Confirmar pedido'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pesoSel && (
        <div className="camera-overlay">
          <form
            className="camera-modal"
            onSubmit={(e) => {
              e.preventDefault()
              confirmarPeso()
            }}
          >
            <div className="modal-top">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setPesoSel(null)}>
                ← Volver
              </button>
              <h2>{pesoSel.producto.nombre}</h2>
            </div>
            <p className="subtitle">{formatCLP(pesoSel.producto.precio)} el kilo</p>
            {pesoSel.modo === 'gramos' && (
              <div className="action-row">
                {GRAMOS_RAPIDOS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => setPesoSel({ ...pesoSel, valor: String(g) })}
                  >
                    {formatGramos(g)}
                  </button>
                ))}
              </div>
            )}
            <p className="campo-etiqueta">
              {pesoSel.modo === 'unidades' ? 'Cantidad de unidades' : 'Gramos (mínimo 50)'}
            </p>
            <div className="peso-controles">
              <Stepper
                value={Math.round(Number(pesoSel.valor)) || 0}
                min={pesoSel.modo === 'gramos' ? 50 : 1}
                step={pesoSel.modo === 'gramos' ? 50 : 1}
                label={
                  pesoSel.modo === 'gramos'
                    ? formatGramos(Math.round(Number(pesoSel.valor)) || 0)
                    : undefined
                }
                onChange={(v) => setPesoSel({ ...pesoSel, valor: String(v) })}
              />
              {pesoSel.modo === 'gramos' && (
                <input
                  type="number"
                  min={50}
                  value={pesoSel.valor}
                  onChange={(e) => setPesoSel({ ...pesoSel, valor: e.target.value })}
                  aria-label="Cantidad exacta"
                  className="peso-input"
                />
              )}
            </div>
            {(() => {
              const n = Math.round(Number(pesoSel.valor)) || 0
              const g = pesoSel.modo === 'unidades' ? n * (pesoSel.producto.gramos_unidad ?? 0) : n
              return (
                <p>
                  {pesoSel.modo === 'unidades' && <>≈ {formatGramos(g)} · </>}
                  {pesoSel.modo === 'unidades' ? 'Aprox: ' : 'Monto: '}
                  <strong>{formatCLP(montoPorPeso(pesoSel.producto.precio, g))}</strong>
                </p>
              )
            })()}
            {pesoSel.modo === 'unidades' && (
              <p className="subtitle">El peso real se mide al armar el pedido; el valor final se ajusta.</p>
            )}
            <div className="camera-actions">
              <button type="submit" className="btn btn-primary">
                Agregar al pedido
              </button>
            </div>
          </form>
        </div>
      )}

      {verHistorial && (
        <div className="camera-overlay">
          <div className="camera-modal">
            <div className="modal-top">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setVerHistorial(false)}>
                ← Volver
              </button>
              <h2>Mis pedidos</h2>
            </div>
            {misPedidos === null && <p className="subtitle">Cargando...</p>}
            {misPedidos !== null && misPedidos.length === 0 && (
              <p className="subtitle">
                Todavía no tienes pedidos en este teléfono. Aquí verás los que hagas desde ahora.
              </p>
            )}
            {(misPedidos ?? []).map((p) => {
              const badge = estadoPedidoBadge(p)
              return (
              <div
                key={p.id}
                className={p.pago_estado === 'pagado' ? 'pedido-tienda-item pedido-pagado' : 'pedido-tienda-item'}
              >
                <p className="subtitle">
                  {new Date(p.created_at).toLocaleString('es-CL', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <span className={badge.clase}>{badge.texto}</span>
                <p className="subtitle">
                  {p.items
                    .map((it) =>
                      it.es_peso
                        ? `${it.nombre_producto} (${it.unidades ? `${it.unidades} un, ` : ''}${it.aprox ? '≈ ' : ''}${formatGramos(it.cantidad)})`
                        : `${it.cantidad}x ${it.nombre_producto}`,
                    )
                    .join(', ')}
                </p>
                <p>
                  Total: <strong>{formatCLP(p.total)}</strong>
                  {p.metodo_pago ? ` · ${METODO_PAGO_LABEL[p.metodo_pago]}` : ''}
                  {' · '}
                  {p.pago_estado === 'pagado' ? (
                    <span className="badge-pagado">PAGADO</span>
                  ) : p.pago_estado === 'esperando_pago' && p.estado === 'cancelado' ? (
                    <span className="badge-pendiente">No pagado</span>
                  ) : p.pago_estado === 'esperando_pago' ? (
                    <span className="badge-pendiente">Esperando pago</span>
                  ) : (
                    <span className="badge-pendiente">Pago pendiente</span>
                  )}
                </p>
                {p.metodo_pago === 'online' && p.pago_estado === 'esperando_pago' && p.estado !== 'cancelado' && (
                  <div className="report-row">
                    <button
                      className="btn btn-primary btn-small"
                      disabled={busyPedido === p.id}
                      onClick={() => pagarPedido(p)}
                    >
                      Pagar ahora
                    </button>
                    <button
                      className="btn btn-secondary btn-small"
                      disabled={busyPedido === p.id}
                      onClick={() => editarPedido(p)}
                    >
                      Editar / agregar más
                    </button>
                    <button
                      className="btn btn-secondary btn-small"
                      disabled={busyPedido === p.id}
                      onClick={() => cancelarPedido(p)}
                    >
                      Cancelar pedido
                    </button>
                  </div>
                )}
                {p.metodo_pago !== 'online' && p.estado === 'pendiente' && (
                  <div className="report-row">
                    <button
                      className="btn btn-secondary btn-small"
                      disabled={busyPedido === p.id}
                      onClick={() => cancelarPedido(p)}
                    >
                      Cancelar pedido
                    </button>
                  </div>
                )}
                {p.estado === 'pendiente' && <NotificacionesPedidoCliente pedidoId={p.id} />}
                {p.metodo_pago === 'online' && p.pago_estado !== 'pagado' && p.estado === 'cancelado' && !p.cancelado_por_cliente && (
                  <div className="report-row">
                    <button
                      className="btn btn-primary btn-small"
                      disabled={busyPedido === p.id}
                      onClick={() => pagarPedido(p)}
                    >
                      Intentar pago nuevamente
                    </button>
                    <button
                      className="btn btn-secondary btn-small"
                      disabled={busyPedido === p.id}
                      onClick={() => editarPedido(p)}
                    >
                      Editar / agregar más
                    </button>
                  </div>
                )}
              </div>
              )
            })}
            <div className="camera-actions">
              <button className="btn btn-secondary" onClick={() => setVerHistorial(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {detalle && (
        <div className="camera-overlay" onClick={() => setDetalle(null)}>
          <div className="camera-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setDetalle(null)}>
                ← Volver
              </button>
            </div>
            {detalle.foto_path ? (
              <FotoImg src={productoFotoUrl(detalle.foto_path)} alt={detalle.nombre} className="detalle-foto" />
            ) : (
              <div className="detalle-foto detalle-foto-vacia">Sin foto</div>
            )}
            <h2 className="detalle-nombre">{detalle.nombre}</h2>
            <p className="detalle-precio">
              {detalle.precio_original && (
                <span className="tienda-precio-original">{formatCLP(detalle.precio_original)}</span>
              )}
              <span className={detalle.precio_original ? 'tienda-precio-descuento' : undefined}>
                {formatCLP(detalle.precio)}
                {detalle.por_peso ? ' el kilo' : ''}
              </span>
              {detalle.descuento_pct && <span className="tienda-descuento-badge">-{detalle.descuento_pct}%</span>}
            </p>
            {detalle.nota && <p className="tienda-nota">📌 {detalle.nota}</p>}
            {detalle.combo_cantidad && detalle.combo_precio && (
              <p className="detalle-pack">
                O pack de {detalle.combo_cantidad} por {formatCLP(detalle.combo_precio)}
                {!detalle.combo_disponible && ' (sin stock suficiente para el pack por ahora)'}
              </p>
            )}
            {enCarrito(detalle.id) > 0 && !detalle.por_peso && (
              <p className="subtitle">Ya tienes {enCarrito(detalle.id)} en tu pedido.</p>
            )}
            {detalle.por_peso ? (
              <button
                className="btn btn-primary"
                onClick={() => {
                  const p = detalle
                  setDetalle(null)
                  abrirPeso(p)
                }}
              >
                Elegir cantidad
              </button>
            ) : (
              <>
                {!detalle.disponible && <p className="error-text">Este producto está sin stock por ahora.</p>}
                <div className="detalle-cantidad">
                  <Stepper
                    value={detalleCant}
                    min={1}
                    max={detalle.stock_max !== null ? Math.max(1, detalle.stock_max - enCarrito(detalle.id)) : null}
                    onChange={setDetalleCant}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  disabled={!detalle.disponible}
                  onClick={() => {
                    addToCart(detalle, detalleCant)
                    setDetalle(null)
                  }}
                >
                  Agregar · {formatCLP(detalle.precio * detalleCant)}
                </button>
                {detalle.combo_cantidad && detalle.combo_precio && (
                  <button
                    className="btn btn-secondary"
                    disabled={!detalle.combo_disponible}
                    onClick={() => {
                      agregarPack(detalle)
                      setDetalle(null)
                    }}
                  >
                    Agregar pack de {detalle.combo_cantidad} · {formatCLP(detalle.combo_precio)}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
