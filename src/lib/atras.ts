import { useEffect, useRef } from 'react'

/**
 * Hace que el boton "atras" del telefono cierre una ventana abierta (detalle,
 * pedido, etc.) en vez de sacar al cliente de la tienda.
 */
export function useAtrasCierra(abierto: boolean, cerrar: () => void) {
  const cerrarRef = useRef(cerrar)
  useEffect(() => {
    cerrarRef.current = cerrar
  })

  useEffect(() => {
    if (!abierto) return
    window.history.pushState({ tltModal: true }, '')
    const onPop = () => cerrarRef.current()
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Si se cerro con un boton (no con "atras"), se quita la entrada extra del historial.
      if (window.history.state?.tltModal) window.history.back()
    }
  }, [abierto])
}
