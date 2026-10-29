import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Logo } from '../components/Logo'
import { FotoImg } from '../components/FotoImg'
import { Stepper } from '../components/Stepper'
import { PromoFoto, PromoIncluye, ahorroPct, ahorroPromo } from '../components/PromoTienda'
import { formatCLP } from '../lib/payroll'
import { formatGramos, montoPorPeso } from '../lib/peso'
import { horarioHoyTexto, horarioSemanaTexto, tiendaAbierta } from '../lib/horarioTienda'
import { guardarCarrito, leerCarrito, mismaLinea, type LineaCarrito } from '../lib/carritoWeb'
import { useArrastreHorizontal } from '../lib/arrastreHorizontal'
import {
  loadCatalogoTienda,
  loadCategoriasTienda,
  loadPromosTienda,
  loadSubcategoriasTienda,
  productoFotoUrl,
  type ProductoTienda,
  type PromoTienda,
} from '../lib/tienda'
import './paginaWeb.css'

/*
 * Pagina web publica de la tienda (/web): vitrina con todo el catalogo en vivo, buscador, filtros y carrito.
 * No toca la tienda (/tienda) ni el ingreso de trabajadores: lee los mismos datos publicos y, para pagar, deja el
 * carrito guardado en el telefono y lleva a la tienda, que lo recupera solo.
 */

/** Cuanto se muestra cada foto del carrusel antes de pasar a la siguiente. */
const DURACION_FOTO_MS = 3000
const WHATSAPP = 'https://wa.me/56971605299?text=Hola%2C%20quiero%20hacer%20un%20pedido'
const POR_PAGINA = 40
const STOCK_BAJO = 3

type Orden = 'destacados' | 'precio-asc' | 'precio-desc' | 'az' | 'ofertas'
type Rango = 'todos' | 'hasta1' | '1a3' | '3a5' | 'mas5'

const RANGOS: { id: Rango; texto: string; min: number; max: number }[] = [
  { id: 'todos', texto: 'Todos los precios', min: 0, max: Infinity },
  { id: 'hasta1', texto: 'Hasta $1.000', min: 0, max: 1000 },
  { id: '1a3', texto: '$1.000 – $3.000', min: 1000, max: 3000 },
  { id: '3a5', texto: '$3.000 – $5.000', min: 3000, max: 5000 },
  { id: 'mas5', texto: 'Más de $5.000', min: 5000, max: Infinity },
]

interface Banner {
  img: string
  titulo: string
  texto: string
  /** Categoria a la que lleva (si existe); si no, se busca por estas palabras. */
  categoria?: string
  busqueda: string
}

const BANNERS: Banner[] = [
  { img: '/web/abarrotes.webp', titulo: 'Abarrotes de calidad', texto: 'Todo para tu despensa', categoria: 'DESPENSA', busqueda: 'arroz' },
  { img: '/web/bebidas.webp', titulo: 'Bebidas bien heladas', texto: 'Gaseosas, jugos y más', categoria: 'BEBIDAS', busqueda: 'coca' },
  { img: '/web/embutidos.webp', titulo: 'Embutidos Díaz', texto: 'Sabor artesanal desde 1982', categoria: 'QUESOS Y FIAMBRERIA', busqueda: 'chorizo' },
  { img: '/web/sincubiertos.webp', titulo: 'Tequeños y masas', texto: 'Sin Cubiertos Gourmet', busqueda: 'tequeños' },
  { img: '/web/limpieza.webp', titulo: 'Cuidado personal y hogar', texto: 'Tu día a día, más fácil', categoria: 'LIMPIEZA Y PERFUMERIA', busqueda: 'colgate' },
]

const ICONOS: [RegExp, string][] = [
  [/halloween/, '🎃'],
  [/promo/, '🎁'],
  [/bebida/, '🥤'],
  [/snack|confite|gomita/, '🍬'],
  [/galleta/, '🍪'],
  [/limpieza|perfumeria/, '🧴'],
  [/hogar|aseo/, '🧽'],
  [/fruta|verdura/, '🥬'],
  [/queso|fiambre/, '🧀'],
  [/lacteo|lacte/, '🥛'],
  [/congelado/, '🧊'],
  [/panader|pastel/, '🥖'],
  [/carne|pollo/, '🍗'],
  [/medicina/, '💊'],
  [/mascota/, '🐾'],
  [/regalo/, '🎁'],
  [/fiesta/, '🎉'],
  [/tecnolog/, '🔌'],
  [/plastico/, '🛍️'],
  [/harina/, '🌾'],
  [/tabaq/, '🚬'],
  [/despensa|abarrote/, '🥫'],
  [/importado/, '🌎'],
]

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function nombreCategoria(c: string): string {
  return c.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** "COCA COLA ORIGINAL 1.5L" -> "Coca Cola Original 1.5L" (las medidas con numeros quedan igual). */
function nombreBonito(n: string): string {
  return n
    .split(' ')
    .map((w) => (/\d/.test(w) || w.length <= 1 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}

function iconoCategoria(c: string): string {
  const n = normalizar(c)
  return ICONOS.find(([re]) => re.test(n))?.[1] ?? '🛒'
}

/** Cuantas unidades (o packs, o gramos) se pueden pedir como maximo de una linea. */
function maximoLinea(p: ProductoTienda, l: Pick<LineaCarrito, 'modo' | 'esCombo'>): number {
  if (l.esCombo) return p.combo_cantidad ? Math.floor((p.stock_max ?? 0) / p.combo_cantidad) : 0
  if (p.por_peso) {
    const g = p.stock_gramos ?? 0
    return l.modo === 'unidades' && p.gramos_unidad ? Math.floor(g / p.gramos_unidad) : g
  }
  return p.stock_max ?? 0
}

function gramosLinea(p: ProductoTienda, l: LineaCarrito): number {
  return l.modo === 'unidades' ? l.cantidad * (p.gramos_unidad ?? 0) : l.cantidad
}

function totalLinea(p: ProductoTienda, l: LineaCarrito): number {
  if (l.esCombo) return l.cantidad * (p.combo_precio ?? 0)
  if (p.por_peso) return montoPorPeso(p.precio, gramosLinea(p, l))
  return l.cantidad * p.precio
}

function textoCantidad(p: ProductoTienda, l: LineaCarrito): string {
  if (l.esCombo) return `${l.cantidad} pack${l.cantidad === 1 ? '' : 's'} de ${p.combo_cantidad}`
  if (p.por_peso) return l.modo === 'unidades' ? `${l.cantidad} un (≈ ${formatGramos(gramosLinea(p, l))})` : formatGramos(l.cantidad)
  return `${l.cantidad} un`
}

/** Linea nueva al tocar "Agregar" en un producto (1 unidad; por peso: 1 unidad aprox. o 250 g). */
function lineaInicial(p: ProductoTienda): LineaCarrito {
  if (p.por_peso) return p.gramos_unidad ? { producto_id: p.id, cantidad: 1, modo: 'unidades' } : { producto_id: p.id, cantidad: 250, modo: 'gramos' }
  return { producto_id: p.id, cantidad: 1 }
}

function pasoLinea(l: LineaCarrito): number {
  return l.modo === 'gramos' ? 250 : 1
}

function quedanPocas(p: ProductoTienda): boolean {
  if (!p.disponible || p.por_peso) return false
  return p.stock_max !== null && p.stock_max <= STOCK_BAJO
}

/** Numero que sube animado hasta `valor` la primera vez que se ve. */
function Contador({ valor, sufijo = '' }: { valor: number; sufijo?: string }) {
  const [mostrado, setMostrado] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || valor <= 0) return
    let frame = 0
    const empezar = () => {
      const inicio = performance.now()
      const dur = 1200
      const paso = (t: number) => {
        const k = Math.min(1, (t - inicio) / dur)
        setMostrado(Math.round(valor * (1 - Math.pow(1 - k, 3))))
        if (k < 1) frame = requestAnimationFrame(paso)
      }
      frame = requestAnimationFrame(paso)
    }
    const obs = new IntersectionObserver((e) => {
      if (e[0].isIntersecting) {
        empezar()
        obs.disconnect()
      }
    })
    obs.observe(el)
    return () => {
      obs.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [valor])
  return (
    <span ref={ref}>
      {mostrado.toLocaleString('es-CL')}
      {sufijo}
    </span>
  )
}

/** Aparece con un fundido suave cuando entra a la pantalla. */
function Revelar({ children, className = '', retraso = 0 }: { children: ReactNode; className?: string; retraso?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      (e) => {
        if (e[0].isIntersecting) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} className={`pw-revelar${visible ? ' visible' : ''} ${className}`} style={{ transitionDelay: `${retraso}ms` }}>
      {children}
    </div>
  )
}

/** Carrusel de las fotos promocionales: avanza solo, se desliza con el dedo y lleva a sus productos. */
function Carrusel({ onElegir }: { onElegir: (b: Banner) => void }) {
  const [idx, setIdx] = useState(0)
  const [pausa, setPausa] = useState(false)
  const inicioX = useRef<number | null>(null)
  const total = BANNERS.length
  const ir = useCallback((n: number) => setIdx(((n % total) + total) % total), [total])

  useEffect(() => {
    if (pausa) return
    const t = setTimeout(() => ir(idx + 1), DURACION_FOTO_MS)
    return () => clearTimeout(t)
  }, [idx, pausa, ir])

  return (
    <div
      className="pw-carrusel"
      onMouseEnter={() => setPausa(true)}
      onMouseLeave={() => setPausa(false)}
      onPointerDown={(e) => {
        inicioX.current = e.clientX
      }}
      onPointerUp={(e) => {
        if (inicioX.current === null) return
        const dx = e.clientX - inicioX.current
        inicioX.current = null
        if (Math.abs(dx) > 40) ir(idx + (dx < 0 ? 1 : -1))
      }}
    >
      {BANNERS.map((b, i) => (
        <div key={b.img} className={`pw-slide${i === idx ? ' activo' : ''}`} aria-hidden={i !== idx}>
          <img src={b.img} alt="" className="pw-slide-fondo" loading={i === 0 ? 'eager' : 'lazy'} />
          <img src={b.img} alt={b.titulo} className="pw-slide-img" loading={i === 0 ? 'eager' : 'lazy'} draggable={false} />
          <div className="pw-slide-pie">
            <div>
              <strong>{b.titulo}</strong>
              <span>{b.texto}</span>
            </div>
            <button type="button" className="pw-btn pw-btn-claro" onClick={() => onElegir(b)} tabIndex={i === idx ? 0 : -1}>
              Ver productos →
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="pw-carrusel-flecha izq" aria-label="Anterior" onClick={() => ir(idx - 1)}>
        ‹
      </button>
      <button type="button" className="pw-carrusel-flecha der" aria-label="Siguiente" onClick={() => ir(idx + 1)}>
        ›
      </button>
      <div className="pw-carrusel-puntos">
        {BANNERS.map((b, i) => (
          <button
            key={b.img}
            type="button"
            aria-label={`Ir a ${b.titulo}`}
            className={i === idx ? 'activo' : ''}
            onClick={() => ir(i)}
          >
            {i === idx && !pausa && <span className="pw-punto-progreso" />}
          </button>
        ))}
      </div>
    </div>
  )
}

export function PaginaWeb() {
  const [productos, setProductos] = useState<ProductoTienda[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [promos, setPromos] = useState<Record<string, PromoTienda>>({})
  const [subcats, setSubcats] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(true)
  const [sinConexion, setSinConexion] = useState(false)

  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('')
  const [subcategoria, setSubcategoria] = useState('')
  const [orden, setOrden] = useState<Orden>('destacados')
  const [rango, setRango] = useState<Rango>('todos')
  const [soloOfertas, setSoloOfertas] = useState(false)
  const [soloDisponibles, setSoloDisponibles] = useState(true)
  const [visibles, setVisibles] = useState(POR_PAGINA)

  const [carrito, setCarrito] = useState<LineaCarrito[]>(() => leerCarrito())
  const [verCarrito, setVerCarrito] = useState(false)
  const [detalle, setDetalle] = useState<ProductoTienda | null>(null)
  const [detalleLinea, setDetalleLinea] = useState<LineaCarrito | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [abierta, setAbierta] = useState(() => tiendaAbierta())
  const [conSombra, setConSombra] = useState(false)

  // En PC las filas que se deslizan (categorias, ofertas, chips) se pueden arrastrar con el mouse o la rueda.
  const [categoriasEl, setCategoriasEl] = useState<HTMLDivElement | null>(null)
  const [rielEl, setRielEl] = useState<HTMLDivElement | null>(null)
  const [chipsEl, setChipsEl] = useState<HTMLDivElement | null>(null)
  useArrastreHorizontal(categoriasEl)
  useArrastreHorizontal(rielEl)
  useArrastreHorizontal(chipsEl)

  const catalogoRef = useRef<HTMLElement>(null)
  const buscadorRef = useRef<HTMLInputElement>(null)
  const masRef = useRef<HTMLDivElement>(null)

  // ---- Datos en vivo (mismo catalogo publico que la tienda) ----
  const cargar = useCallback(async () => {
    try {
      const [prods, cats] = await Promise.all([loadCatalogoTienda({}), loadCategoriasTienda()])
      setProductos(prods)
      setCategorias(cats)
      setSinConexion(false)
      loadPromosTienda().then(setPromos).catch(() => {})
      loadSubcategoriasTienda().then(setSubcats).catch(() => {})
    } catch {
      setSinConexion(true)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 60000)
    const alVolver = () => {
      if (document.visibilityState === 'visible') {
        cargar()
        setCarrito(leerCarrito())
      }
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('online', cargar)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('online', cargar)
    }
  }, [cargar])

  useEffect(() => {
    const t = setInterval(() => setAbierta(tiendaAbierta()), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const titulo = document.title
    document.title = 'Te Lo Tengo Market · Todo lo que necesitas, en tu depto'
    return () => {
      document.title = titulo
    }
  }, [])

  useEffect(() => {
    const alScroll = () => setConSombra(window.scrollY > 8)
    alScroll()
    window.addEventListener('scroll', alScroll, { passive: true })
    return () => window.removeEventListener('scroll', alScroll)
  }, [])

  // El carrito queda guardado en el telefono (mismo que usa la tienda) y se sincroniza entre pestañas.
  useEffect(() => {
    guardarCarrito(carrito)
  }, [carrito])
  useEffect(() => {
    const alCambiar = (e: StorageEvent) => {
      if (e.key === 'tlt-carrito-v1') setCarrito(leerCarrito())
    }
    window.addEventListener('storage', alCambiar)
    return () => window.removeEventListener('storage', alCambiar)
  }, [])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 2200)
    return () => clearTimeout(t)
  }, [aviso])

  // Con una ventana abierta, la pagina de atras no se mueve.
  useEffect(() => {
    const bloquear = verCarrito || detalle !== null
    document.body.classList.toggle('pw-sin-scroll', bloquear)
    return () => document.body.classList.remove('pw-sin-scroll')
  }, [verCarrito, detalle])

  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])

  // ---- Filtros ----
  const filtrados = useMemo(() => {
    const palabras = normalizar(busqueda).split(' ').filter(Boolean)
    const r = RANGOS.find((x) => x.id === rango) ?? RANGOS[0]
    let lista = productos.filter((p) => {
      if (categoria && p.categoria !== categoria) return false
      if (subcategoria && subcats[p.id] !== subcategoria) return false
      if (soloDisponibles && !p.disponible) return false
      if (soloOfertas && !(p.descuento_pct || promos[p.id] || p.combo_precio)) return false
      if (p.precio < r.min || p.precio >= r.max) return false
      if (palabras.length) {
        const texto = normalizar(`${p.nombre} ${p.categoria ?? ''} ${subcats[p.id] ?? ''}`)
        if (!palabras.every((w) => texto.includes(w))) return false
      }
      return true
    })
    if (orden === 'precio-asc') lista = [...lista].sort((a, b) => a.precio - b.precio)
    else if (orden === 'precio-desc') lista = [...lista].sort((a, b) => b.precio - a.precio)
    else if (orden === 'az') lista = [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre))
    else if (orden === 'ofertas') {
      const pct = (p: ProductoTienda) => p.descuento_pct ?? (promos[p.id] ? ahorroPct(promos[p.id], p.precio) ?? 0 : 0)
      lista = [...lista].sort((a, b) => pct(b) - pct(a))
    }
    return lista
  }, [productos, busqueda, categoria, subcategoria, soloDisponibles, soloOfertas, rango, orden, subcats, promos])

  useEffect(() => {
    setVisibles(POR_PAGINA)
  }, [busqueda, categoria, subcategoria, soloDisponibles, soloOfertas, rango, orden])

  // Carga mas productos sola al llegar al final de la lista.
  useEffect(() => {
    const el = masRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (e) => {
        if (e[0].isIntersecting) setVisibles((v) => v + POR_PAGINA)
      },
      { rootMargin: '600px 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [filtrados.length, visibles])

  const subsDeCategoria = useMemo(() => {
    if (!categoria) return []
    return [...new Set(productos.filter((p) => p.categoria === categoria).map((p) => subcats[p.id]).filter(Boolean))].sort()
  }, [categoria, productos, subcats])

  const conteoCategoria = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of productos) if (p.disponible && p.categoria) m.set(p.categoria, (m.get(p.categoria) ?? 0) + 1)
    return m
  }, [productos])

  const fotosCategoria = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const p of productos) {
      if (!p.categoria || !p.foto_path || !p.disponible) continue
      const l = m.get(p.categoria) ?? []
      if (l.length < 3) l.push(p.foto_path)
      m.set(p.categoria, l)
    }
    return m
  }, [productos])

  const ofertas = useMemo(
    () => productos.filter((p) => p.disponible && (p.descuento_pct || promos[p.id] || p.destacado)).slice(0, 14),
    [productos, promos],
  )

  const vitrina = useMemo(() => productos.filter((p) => p.disponible && p.foto_path).slice(0, 6), [productos])
  const disponibles = useMemo(() => productos.filter((p) => p.disponible).length, [productos])
  const cantOfertas = useMemo(() => productos.filter((p) => p.disponible && (p.descuento_pct || promos[p.id])).length, [productos, promos])

  const hayFiltros = !!(busqueda || categoria || subcategoria || soloOfertas || !soloDisponibles || rango !== 'todos' || orden !== 'destacados')

  function limpiarFiltros() {
    setBusqueda('')
    setCategoria('')
    setSubcategoria('')
    setSoloOfertas(false)
    setSoloDisponibles(true)
    setRango('todos')
    setOrden('destacados')
  }

  function irAlCatalogo(enfocar = false) {
    catalogoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (enfocar) setTimeout(() => buscadorRef.current?.focus({ preventScroll: true }), 450)
  }

  function elegirCategoria(c: string) {
    setCategoria(c)
    setSubcategoria('')
    setBusqueda('')
    irAlCatalogo()
  }

  function elegirBanner(b: Banner) {
    limpiarFiltros()
    if (b.categoria && categorias.includes(b.categoria)) setCategoria(b.categoria)
    else setBusqueda(b.busqueda)
    irAlCatalogo()
  }

  // ---- Carrito ----
  const lineaDe = (id: string, esCombo = false) => carrito.find((l) => mismaLinea(l, { producto_id: id, esCombo }))

  function ponerLinea(nueva: LineaCarrito) {
    setCarrito((prev) => {
      const sin = prev.filter((l) => !mismaLinea(l, nueva))
      return nueva.cantidad > 0 ? [...sin, nueva] : sin
    })
  }

  function agregar(p: ProductoTienda, linea: LineaCarrito = lineaInicial(p)) {
    if (!abierta || !p.disponible) return
    const existente = lineaDe(p.id, !!linea.esCombo)
    const max = maximoLinea(p, linea)
    const cantidad = Math.min(max, (existente && existente.modo === linea.modo ? existente.cantidad : 0) + linea.cantidad)
    if (cantidad <= 0) return
    ponerLinea({ ...linea, cantidad })
    setAviso(`✓ ${nombreBonito(p.nombre)} agregado`)
  }

  const lineasValidas = carrito.filter((l) => porId.has(l.producto_id))
  const totalCarrito = lineasValidas.reduce((s, l) => s + totalLinea(porId.get(l.producto_id)!, l), 0)
  const unidadesCarrito = carrito.reduce((s, l) => s + (l.modo === 'gramos' ? 1 : l.cantidad), 0)

  function irAPagar() {
    guardarCarrito(carrito)
    window.location.href = '/tienda'
  }

  function abrirDetalle(p: ProductoTienda) {
    setDetalle(p)
    const existente = lineaDe(p.id)
    setDetalleLinea(existente ?? lineaInicial(p))
  }

  // ---- Piezas ----
  // Funcion (no componente) para que las tarjetas no se vuelvan a montar en cada cambio y las fotos no parpadeen.
  function tarjeta(p: ProductoTienda) {
    const promo = promos[p.id]
    const linea = lineaDe(p.id)
    const pct = p.descuento_pct ?? (promo ? ahorroPct(promo, p.precio) : null)
    return (
      <article key={p.id} className={`pw-card${p.disponible ? '' : ' agotado'}${promo ? ' promo' : ''}`}>
        <button type="button" className="pw-card-foto" onClick={() => abrirDetalle(p)} aria-label={`Ver ${p.nombre}`}>
          {promo ? (
            <PromoFoto fotoPath={p.foto_path} promo={promo} nombre={p.nombre} precio={p.precio} />
          ) : p.foto_path ? (
            <FotoImg src={productoFotoUrl(p.foto_path)} alt={p.nombre} className="pw-card-img" />
          ) : (
            <span className="pw-card-sinfoto">{iconoCategoria(p.categoria ?? '')}</span>
          )}
          {!promo && pct ? <span className="pw-badge pw-badge-oferta">-{pct}%</span> : null}
          {!p.disponible && <span className="pw-badge pw-badge-agotado">Agotado</span>}
          {quedanPocas(p) && <span className="pw-badge pw-badge-pocas">¡Últimas {p.stock_max}!</span>}
        </button>
        <div className="pw-card-cuerpo">
          {p.categoria && <span className="pw-card-cat">{nombreCategoria(p.categoria)}</span>}
          <h3 className="pw-card-nombre" onClick={() => abrirDetalle(p)}>
            {nombreBonito(p.nombre)}
          </h3>
          <div className="pw-card-precio">
            {(p.precio_original || (promo && ahorroPromo(promo, p.precio) > 0)) && (
              <s>{formatCLP(p.precio_original ?? promo!.precio_separado)}</s>
            )}
            <strong className={pct ? 'rebajado' : ''}>
              {formatCLP(p.precio)}
              {p.por_peso && <small> /kg</small>}
            </strong>
          </div>
          {p.combo_cantidad && p.combo_precio && (
            <span className="pw-card-pack">
              Pack {p.combo_cantidad} × {formatCLP(p.combo_precio)}
            </span>
          )}
          <div className="pw-card-accion">
            {linea && p.disponible ? (
              <Stepper
                value={linea.cantidad}
                min={0}
                step={pasoLinea(linea)}
                max={maximoLinea(p, linea)}
                label={linea.modo === 'gramos' ? formatGramos(linea.cantidad) : undefined}
                onChange={(n) => ponerLinea({ ...linea, cantidad: n })}
              />
            ) : (
              <button
                type="button"
                className="pw-btn pw-btn-agregar"
                disabled={!p.disponible || !abierta}
                onClick={() => agregar(p)}
              >
                {!p.disponible ? 'Agotado' : !abierta ? 'Tienda cerrada' : '+ Agregar'}
              </button>
            )}
          </div>
        </div>
      </article>
    )
  }

  return (
    <div className="pw">
      {/* Cinta de avisos */}
      <div className="pw-cinta" aria-hidden="true">
        <div className="pw-cinta-pista">
          {[0, 1].map((k) => (
            <span key={k}>
              🚚 Delivery dentro del condominio · 💳 Paga online o al recibir · 🕒 Hoy de {horarioHoyTexto()} · 🎟️ Cupones de
              descuento · 💬 Atención por WhatsApp · 🥤 Bebidas heladas · 🥖 Pan fresco ·&nbsp;
            </span>
          ))}
        </div>
      </div>

      {/* Cabecera */}
      <header className={`pw-header${conSombra ? ' sombra' : ''}`}>
        <a href="/web" className="pw-marca" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
          <Logo size={38} />
          <span>
            <strong>Te Lo Tengo</strong>
            <small>Market</small>
          </span>
        </a>
        <label className="pw-header-buscar">
          <span aria-hidden="true">🔍</span>
          <input
            type="search"
            placeholder="Busca entre todos los productos…"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value)
              if (window.scrollY < (catalogoRef.current?.offsetTop ?? 0) - 200) irAlCatalogo()
            }}
          />
        </label>
        <nav className="pw-header-acciones">
          <button type="button" className="pw-icono-btn pw-solo-movil" aria-label="Buscar" onClick={() => irAlCatalogo(true)}>
            🔍
          </button>
          <a href="/tienda" className="pw-btn pw-btn-fantasma pw-solo-escritorio">
            Mis pedidos
          </a>
          <button type="button" className="pw-carrito-btn" onClick={() => setVerCarrito(true)} aria-label="Ver carrito">
            🛒
            {unidadesCarrito > 0 && <span className="pw-carrito-cant">{unidadesCarrito}</span>}
          </button>
        </nav>
      </header>

      {/* Portada */}
      <section className="pw-hero">
        <div className="pw-hero-fondo" aria-hidden="true">
          <span className="pw-burbuja b1" />
          <span className="pw-burbuja b2" />
          <span className="pw-burbuja b3" />
        </div>
        <div className="pw-hero-texto">
          <span className={`pw-estado${abierta ? ' abierto' : ''}`}>
            <i />
            {abierta ? `Abierto ahora · hoy de ${horarioHoyTexto()}` : `Cerrado ahora · hoy de ${horarioHoyTexto()}`}
          </span>
          <h1>
            Todo lo que necesitas,
            <br />
            <span className="pw-degradado">a la puerta de tu depto.</span>
          </h1>
          <p>
            Tu minimarket dentro del condominio: despensa, bebidas, frescos, limpieza y mucho más. Pide en un minuto y paga
            online o al recibir.
          </p>
          <div className="pw-hero-botones">
            <button type="button" className="pw-btn pw-btn-principal" onClick={() => irAlCatalogo()}>
              Ver productos
            </button>
            <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="pw-btn pw-btn-whatsapp">
              💬 Pedir por WhatsApp
            </a>
          </div>
          <div className="pw-stats">
            <div>
              <strong>
                <Contador valor={disponibles} sufijo="+" />
              </strong>
              <span>productos</span>
            </div>
            <div>
              <strong>
                <Contador valor={categorias.length} />
              </strong>
              <span>categorías</span>
            </div>
            <div>
              <strong>{cantOfertas > 0 ? <Contador valor={cantOfertas} /> : '🎟️'}</strong>
              <span>{cantOfertas > 0 ? 'ofertas hoy' : 'cupones'}</span>
            </div>
          </div>
        </div>
        <div className="pw-hero-vitrina" aria-hidden="true">
          {vitrina.map((p, i) => (
            <button
              type="button"
              key={p.id}
              className={`pw-flotante f${i + 1}`}
              onClick={() => abrirDetalle(p)}
              tabIndex={-1}
            >
              <img src={productoFotoUrl(p.foto_path!)} alt="" loading="lazy" />
              <span>{formatCLP(p.precio)}</span>
            </button>
          ))}
        </div>
      </section>

      {sinConexion && <p className="pw-aviso-red">📶 Sin conexión. Reintentando solo…</p>}

      {/* Carrusel */}
      <section className="pw-seccion">
        <Revelar>
          <Carrusel onElegir={elegirBanner} />
        </Revelar>
      </section>

      {/* Categorias */}
      <section className="pw-seccion">
        <Revelar>
          <div className="pw-titulo">
            <h2>Explora por categoría</h2>
            <p>Encuentra lo que buscas en segundos.</p>
          </div>
        </Revelar>
        <div className="pw-categorias" ref={setCategoriasEl}>
          {(cargando ? Array.from({ length: 8 }, (_, i) => `cargando-${i}`) : categorias).map((c, i) =>
            cargando ? (
              <div key={c} className="pw-cat pw-esqueleto" />
            ) : (
              <Revelar key={c} retraso={Math.min(i, 10) * 40}>
                <button type="button" className="pw-cat" onClick={() => elegirCategoria(c)}>
                  <span className="pw-cat-fotos" aria-hidden="true">
                    {(fotosCategoria.get(c) ?? []).length > 0 ? (
                      (fotosCategoria.get(c) ?? []).map((f) => <img key={f} src={productoFotoUrl(f)} alt="" loading="lazy" />)
                    ) : (
                      <span className="pw-cat-icono-grande">{iconoCategoria(c)}</span>
                    )}
                  </span>
                  <span className="pw-cat-nombre">
                    {iconoCategoria(c)} {nombreCategoria(c)}
                  </span>
                  <span className="pw-cat-cant">{conteoCategoria.get(c) ?? 0} productos</span>
                </button>
              </Revelar>
            ),
          )}
        </div>
      </section>

      {/* Ofertas y destacados */}
      {ofertas.length > 0 && (
        <section className="pw-seccion">
          <Revelar>
            <div className="pw-titulo pw-titulo-fila">
              <div>
                <h2>🔥 Ofertas y destacados</h2>
                <p>Lo que más conviene hoy.</p>
              </div>
              <button
                type="button"
                className="pw-btn pw-btn-fantasma"
                onClick={() => {
                  limpiarFiltros()
                  setSoloOfertas(true)
                  setOrden('ofertas')
                  irAlCatalogo()
                }}
              >
                Ver todas →
              </button>
            </div>
          </Revelar>
          <div className="pw-riel" ref={setRielEl}>
            {ofertas.map((p) => tarjeta(p))}
          </div>
        </section>
      )}

      {/* Catalogo */}
      <section className="pw-seccion pw-catalogo" ref={catalogoRef}>
        <div className="pw-titulo pw-titulo-fila">
          <div>
            <h2>{categoria ? `${iconoCategoria(categoria)} ${nombreBonito(nombreCategoria(categoria))}` : 'Todos los productos'}</h2>
            <p>
              {cargando ? 'Cargando…' : `${filtrados.length} producto${filtrados.length === 1 ? '' : 's'}`}
              {busqueda && ` para "${busqueda}"`}
            </p>
          </div>
          {hayFiltros && (
            <button type="button" className="pw-btn pw-btn-fantasma" onClick={limpiarFiltros}>
              ✕ Limpiar filtros
            </button>
          )}
        </div>

        <div className="pw-filtros">
          <label className="pw-buscar">
            <span aria-hidden="true">🔍</span>
            <input
              ref={buscadorRef}
              type="search"
              placeholder="¿Qué necesitas? Ej: coca cola, pan, detergente"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              enterKeyHint="search"
            />
          </label>
          <div className="pw-filtros-fila">
            <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)} aria-label="Ordenar">
              <option value="destacados">⭐ Destacados</option>
              <option value="ofertas">🔥 Mejores ofertas</option>
              <option value="precio-asc">Precio: menor a mayor</option>
              <option value="precio-desc">Precio: mayor a menor</option>
              <option value="az">Nombre: A – Z</option>
            </select>
            <select value={rango} onChange={(e) => setRango(e.target.value as Rango)} aria-label="Precio">
              {RANGOS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.texto}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`pw-toggle${soloOfertas ? ' activo' : ''}`}
              onClick={() => setSoloOfertas((v) => !v)}
              aria-pressed={soloOfertas}
            >
              🔥 Ofertas
            </button>
            <button
              type="button"
              className={`pw-toggle${soloDisponibles ? ' activo' : ''}`}
              onClick={() => setSoloDisponibles((v) => !v)}
              aria-pressed={soloDisponibles}
            >
              ✓ Con stock
            </button>
          </div>
          <div className="pw-chips" role="tablist" aria-label="Categorías" ref={setChipsEl}>
            <button type="button" className={`pw-chip${categoria === '' ? ' activo' : ''}`} onClick={() => elegirCategoria('')}>
              Todas
            </button>
            {categorias.map((c) => (
              <button
                key={c}
                type="button"
                className={`pw-chip${categoria === c ? ' activo' : ''}`}
                onClick={() => {
                  setCategoria(c)
                  setSubcategoria('')
                }}
              >
                {iconoCategoria(c)} {nombreCategoria(c)}
              </button>
            ))}
          </div>
          {subsDeCategoria.length > 0 && (
            <div className="pw-chips pw-subchips">
              <button type="button" className={`pw-chip${subcategoria === '' ? ' activo' : ''}`} onClick={() => setSubcategoria('')}>
                Todo
              </button>
              {subsDeCategoria.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`pw-chip${subcategoria === s ? ' activo' : ''}`}
                  onClick={() => setSubcategoria(s)}
                >
                  {s.toLowerCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {cargando ? (
          <div className="pw-grid">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="pw-card pw-esqueleto" />
            ))}
          </div>
        ) : filtrados.length === 0 ? (
          <div className="pw-vacio">
            <span>🔎</span>
            <h3>No encontramos productos con esos filtros</h3>
            <p>Prueba con otra palabra o quita algún filtro.</p>
            <button type="button" className="pw-btn pw-btn-principal" onClick={limpiarFiltros}>
              Ver todos los productos
            </button>
          </div>
        ) : (
          <>
            <div className="pw-grid">
              {filtrados.slice(0, visibles).map((p) => tarjeta(p))}
            </div>
            {visibles < filtrados.length && (
              <div className="pw-mas" ref={masRef}>
                <button type="button" className="pw-btn pw-btn-fantasma" onClick={() => setVisibles((v) => v + POR_PAGINA)}>
                  Ver más productos ({filtrados.length - visibles})
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Como funciona */}
      <section className="pw-seccion">
        <Revelar>
          <div className="pw-titulo">
            <h2>Así de fácil</h2>
            <p>Tu pedido en la puerta, sin salir del condominio.</p>
          </div>
        </Revelar>
        <div className="pw-pasos">
          {[
            ['🛒', 'Elige tus productos', 'Busca, filtra y agrega al carrito todo lo que necesites.'],
            ['💳', 'Paga como quieras', 'Online con tarjeta, o al recibir en efectivo o tarjeta.'],
            ['🚚', 'Te lo llevamos', 'Lo llevamos directo a tu depto, dentro del condominio.'],
          ].map(([icono, titulo, texto], i) => (
            <Revelar key={titulo} retraso={i * 120}>
              <div className="pw-paso">
                <span className="pw-paso-num">{i + 1}</span>
                <span className="pw-paso-icono">{icono}</span>
                <h3>{titulo}</h3>
                <p>{texto}</p>
              </div>
            </Revelar>
          ))}
        </div>
      </section>

      {/* Beneficios + horario */}
      <section className="pw-seccion">
        <div className="pw-beneficios">
          <Revelar className="pw-beneficio-grande">
            <div className="pw-horario">
              <span className={`pw-estado${abierta ? ' abierto' : ''}`}>
                <i />
                {abierta ? 'Abierto ahora' : 'Cerrado ahora'}
              </span>
              <h3>Horario de atención</h3>
              <p className="pw-horario-texto">{horarioSemanaTexto()}</p>
              <a href="/tienda" className="pw-btn pw-btn-principal">
                Hacer mi pedido
              </a>
            </div>
          </Revelar>
          {[
            ['🏠', 'Dentro del condominio', 'Delivery directo a tu puerta.'],
            ['🎟️', 'Cupones de descuento', 'Te llegan directo a la tienda.'],
            ['🔒', 'Pago seguro', 'Pago online protegido o al recibir.'],
            ['💬', 'Atención cercana', 'Escríbenos por WhatsApp cuando quieras.'],
          ].map(([icono, titulo, texto], i) => (
            <Revelar key={titulo} retraso={i * 80}>
              <div className="pw-beneficio">
                <span>{icono}</span>
                <h3>{titulo}</h3>
                <p>{texto}</p>
              </div>
            </Revelar>
          ))}
        </div>
      </section>

      {/* Llamado final */}
      <section className="pw-seccion">
        <Revelar>
          <div className="pw-cta">
            <div>
              <h2>¿Listo para tu pedido?</h2>
              <p>Más de {disponibles} productos esperando por ti.</p>
            </div>
            <div className="pw-hero-botones">
              <button type="button" className="pw-btn pw-btn-claro" onClick={() => irAlCatalogo(true)}>
                Buscar productos
              </button>
              <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="pw-btn pw-btn-whatsapp">
                💬 WhatsApp
              </a>
            </div>
          </div>
        </Revelar>
      </section>

      <footer className="pw-footer">
        <div className="pw-marca">
          <Logo size={40} />
          <span>
            <strong>Te Lo Tengo</strong>
            <small>Market</small>
          </span>
        </div>
        <nav>
          <a href="/tienda">Tienda</a>
          <a href="/tienda">Mis pedidos</a>
          <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
          <a href="/">Ingreso trabajadores</a>
        </nav>
        <p>Delivery dentro del condominio · {horarioSemanaTexto()}</p>
      </footer>

      {/* Boton flotante del carrito */}
      {unidadesCarrito > 0 && !verCarrito && (
        <button type="button" className="pw-fab" onClick={() => setVerCarrito(true)}>
          <span>🛒 {unidadesCarrito}</span>
          <strong>{formatCLP(totalCarrito)}</strong>
          <span className="pw-fab-ir">Ver carrito →</span>
        </button>
      )}

      {aviso && <div className="pw-toast">{aviso}</div>}

      {/* Carrito */}
      {verCarrito && (
        <div className="pw-capa" onClick={() => setVerCarrito(false)}>
          <aside className="pw-drawer" onClick={(e) => e.stopPropagation()} aria-label="Carrito">
            <div className="pw-drawer-cabeza">
              <h2>Tu carrito</h2>
              <button type="button" className="pw-icono-btn" onClick={() => setVerCarrito(false)} aria-label="Cerrar">
                ✕
              </button>
            </div>
            {carrito.length === 0 ? (
              <div className="pw-vacio">
                <span>🛒</span>
                <h3>Tu carrito está vacío</h3>
                <p>Agrega productos y aparecerán aquí.</p>
                <button
                  type="button"
                  className="pw-btn pw-btn-principal"
                  onClick={() => {
                    setVerCarrito(false)
                    irAlCatalogo()
                  }}
                >
                  Ver productos
                </button>
              </div>
            ) : (
              <>
                <ul className="pw-drawer-lista">
                  {carrito.map((l) => {
                    const p = porId.get(l.producto_id)
                    if (!p) {
                      return (
                        <li key={l.producto_id + (l.esCombo ? 'c' : '')} className="pw-drawer-item">
                          <span className="pw-drawer-foto">🛒</span>
                          <div className="pw-drawer-info">
                            <strong>Producto no disponible</strong>
                            <button type="button" className="pw-link" onClick={() => ponerLinea({ ...l, cantidad: 0 })}>
                              Quitar
                            </button>
                          </div>
                        </li>
                      )
                    }
                    return (
                      <li key={l.producto_id + (l.esCombo ? 'c' : '')} className="pw-drawer-item">
                        {p.foto_path ? (
                          <img src={productoFotoUrl(p.foto_path)} alt="" className="pw-drawer-foto" />
                        ) : (
                          <span className="pw-drawer-foto">{iconoCategoria(p.categoria ?? '')}</span>
                        )}
                        <div className="pw-drawer-info">
                          <strong>{nombreBonito(p.nombre)}</strong>
                          <span>{textoCantidad(p, l)}</span>
                          <div className="pw-drawer-fila">
                            <Stepper
                              value={l.cantidad}
                              min={0}
                              step={pasoLinea(l)}
                              max={maximoLinea(p, l)}
                              label={l.modo === 'gramos' ? formatGramos(l.cantidad) : undefined}
                              onChange={(n) => ponerLinea({ ...l, cantidad: n })}
                            />
                            <b>{formatCLP(totalLinea(p, l))}</b>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <div className="pw-drawer-pie">
                  <div className="pw-drawer-total">
                    <span>Total aproximado</span>
                    <strong>{formatCLP(totalCarrito)}</strong>
                  </div>
                  <p>En la tienda confirmas tus datos, aplicas tu cupón y eliges cómo pagar.</p>
                  <button type="button" className="pw-btn pw-btn-principal pw-btn-ancho" onClick={irAPagar}>
                    Ir a pagar →
                  </button>
                  <button type="button" className="pw-link" onClick={() => setCarrito([])}>
                    Vaciar carrito
                  </button>
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {/* Vista rapida del producto */}
      {detalle && detalleLinea && (
        <div className="pw-capa pw-capa-centro" onClick={() => setDetalle(null)}>
          <div className="pw-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={detalle.nombre}>
            <button type="button" className="pw-icono-btn pw-modal-cerrar" onClick={() => setDetalle(null)} aria-label="Cerrar">
              ✕
            </button>
            <div className="pw-modal-foto">
              {promos[detalle.id] ? (
                <PromoFoto fotoPath={detalle.foto_path} promo={promos[detalle.id]} nombre={detalle.nombre} precio={detalle.precio} grande />
              ) : detalle.foto_path ? (
                <img src={productoFotoUrl(detalle.foto_path)} alt={detalle.nombre} />
              ) : (
                <span className="pw-card-sinfoto">{iconoCategoria(detalle.categoria ?? '')}</span>
              )}
            </div>
            <div className="pw-modal-info">
              {detalle.categoria && (
                <button type="button" className="pw-card-cat pw-link" onClick={() => { setDetalle(null); elegirCategoria(detalle.categoria!) }}>
                  {iconoCategoria(detalle.categoria)} {nombreCategoria(detalle.categoria)}
                </button>
              )}
              <h2>{nombreBonito(detalle.nombre)}</h2>
              <div className="pw-card-precio pw-modal-precio">
                {detalle.precio_original && <s>{formatCLP(detalle.precio_original)}</s>}
                {promos[detalle.id] && ahorroPromo(promos[detalle.id], detalle.precio) > 0 && (
                  <s>{formatCLP(promos[detalle.id].precio_separado)}</s>
                )}
                <strong className={detalle.precio_original ? 'rebajado' : ''}>
                  {formatCLP(detalle.precio)}
                  {detalle.por_peso && <small> el kilo</small>}
                </strong>
                {detalle.descuento_pct && <span className="pw-badge pw-badge-oferta estatico">-{detalle.descuento_pct}%</span>}
              </div>
              {detalle.nota && !(promos[detalle.id] && detalle.nota.startsWith('Incluye:')) && (
                <p className="pw-modal-nota">📌 {detalle.nota}</p>
              )}
              {promos[detalle.id] && <PromoIncluye promo={promos[detalle.id]} />}
              {!detalle.disponible ? (
                <p className="pw-modal-alerta">Este producto está agotado por ahora.</p>
              ) : (
                <>
                  {quedanPocas(detalle) && <p className="pw-modal-alerta">¡Quedan solo {detalle.stock_max}!</p>}
                  {detalle.por_peso && detalle.gramos_unidad && (
                    <div className="pw-modo">
                      <button
                        type="button"
                        className={`pw-toggle${detalleLinea.modo === 'unidades' ? ' activo' : ''}`}
                        onClick={() => setDetalleLinea({ producto_id: detalle.id, cantidad: 1, modo: 'unidades' })}
                      >
                        Por unidad
                      </button>
                      <button
                        type="button"
                        className={`pw-toggle${detalleLinea.modo === 'gramos' ? ' activo' : ''}`}
                        onClick={() => setDetalleLinea({ producto_id: detalle.id, cantidad: 500, modo: 'gramos' })}
                      >
                        Por gramos
                      </button>
                    </div>
                  )}
                  {detalle.combo_cantidad && detalle.combo_precio && detalle.combo_disponible && (
                    <div className="pw-modo">
                      <button
                        type="button"
                        className={`pw-toggle${!detalleLinea.esCombo ? ' activo' : ''}`}
                        onClick={() => setDetalleLinea({ producto_id: detalle.id, cantidad: 1 })}
                      >
                        Unidad · {formatCLP(detalle.precio)}
                      </button>
                      <button
                        type="button"
                        className={`pw-toggle${detalleLinea.esCombo ? ' activo' : ''}`}
                        onClick={() => setDetalleLinea({ producto_id: detalle.id, cantidad: 1, esCombo: true })}
                      >
                        Pack {detalle.combo_cantidad} · {formatCLP(detalle.combo_precio)}
                      </button>
                    </div>
                  )}
                  <div className="pw-modal-comprar">
                    <Stepper
                      value={detalleLinea.cantidad}
                      min={pasoLinea(detalleLinea)}
                      step={pasoLinea(detalleLinea)}
                      max={Math.max(pasoLinea(detalleLinea), maximoLinea(detalle, detalleLinea))}
                      label={detalleLinea.modo === 'gramos' ? formatGramos(detalleLinea.cantidad) : undefined}
                      onChange={(n) => setDetalleLinea({ ...detalleLinea, cantidad: n })}
                    />
                    <button
                      type="button"
                      className="pw-btn pw-btn-principal"
                      disabled={!abierta}
                      onClick={() => {
                        const max = maximoLinea(detalle, detalleLinea)
                        ponerLinea({ ...detalleLinea, cantidad: Math.min(max, detalleLinea.cantidad) })
                        setAviso(`✓ ${nombreBonito(detalle.nombre)} en tu carrito`)
                        setDetalle(null)
                      }}
                    >
                      {abierta ? `Agregar · ${formatCLP(totalLinea(detalle, detalleLinea))}` : 'Tienda cerrada'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
