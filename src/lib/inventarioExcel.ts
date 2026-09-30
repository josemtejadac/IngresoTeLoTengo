import * as XLSX from 'xlsx'
import { coincideFiltroStock, loadProductos, type FiltroStock } from './inventario'

const NOMBRE_FILTRO: Record<FiltroStock, string> = {
  todos: 'todos',
  sinprecio: 'sin-precio',
  sinstock: 'sin-stock',
  bajostock: 'bajo-stock',
}

/** Descarga en Excel el catalogo activo (con o sin stock segun el filtro elegido), no el catalogo oculto. */
export async function downloadInventarioExcel(filtro: FiltroStock = 'todos') {
  const todos = await loadProductos({ orden: 'nombre', limit: 5000 })
  const productos = todos.filter((p) => coincideFiltroStock(p, filtro))
  if (productos.length === 0) throw new Error('No hay productos que coincidan con ese filtro.')

  const filas = productos.map((p) => ({
    Producto: p.nombre,
    Categoría: p.categoria ?? '',
    Precio: p.precio ?? '',
    'Precio por kilo': p.por_peso,
    Stock: p.stock,
    Unidad: p.por_peso ? 'gramos' : 'unidades',
    'Código de barras': p.codigo_barras ?? '',
  }))

  const hoja = XLSX.utils.json_to_sheet(filas)
  hoja['!cols'] = [{ wch: 40 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 16 }]

  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Inventario')

  const hoy = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(libro, `inventario-${NOMBRE_FILTRO[filtro]}-${hoy}.xlsx`)
}
