import { useEffect } from 'react'

/**
 * En PC, una fila con desplazamiento horizontal (ej. las categorias de la tienda) no se puede deslizar como en
 * el celular. Esto permite arrastrarla con el mouse y moverla con la rueda. En el celular no cambia nada.
 * `el` viene de un ref de callback (useState), asi se engancha aunque la fila aparezca despues.
 */
export function useArrastreHorizontal(el: HTMLElement | null) {
  useEffect(() => {
    if (!el) return

    // Rueda del mouse: si la fila puede moverse hacia ese lado, la mueve en vez de bajar la pagina.
    const alRodar = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 0) return
      const puede = e.deltaY > 0 ? el.scrollLeft < max - 1 : el.scrollLeft > 0
      if (!puede) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }

    // Arrastre con el mouse. Si se arrastro, el clic que viene al soltar no cambia de categoria.
    let inicioX = 0
    let inicioScroll = 0
    let apretado = false
    let arrastrado = false
    const alApretar = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      apretado = true
      arrastrado = false
      inicioX = e.clientX
      inicioScroll = el.scrollLeft
    }
    const alMover = (e: PointerEvent) => {
      if (!apretado) return
      const dx = e.clientX - inicioX
      if (!arrastrado && Math.abs(dx) < 6) return
      if (!arrastrado) {
        arrastrado = true
        el.classList.add('arrastrando')
      }
      el.scrollLeft = inicioScroll - dx
    }
    const alSoltar = () => {
      if (!apretado) return
      apretado = false
      el.classList.remove('arrastrando')
    }
    const alClic = (e: MouseEvent) => {
      if (!arrastrado) return
      arrastrado = false
      e.preventDefault()
      e.stopPropagation()
    }

    el.addEventListener('wheel', alRodar, { passive: false })
    el.addEventListener('pointerdown', alApretar)
    window.addEventListener('pointermove', alMover)
    window.addEventListener('pointerup', alSoltar)
    el.addEventListener('click', alClic, true)
    return () => {
      el.removeEventListener('wheel', alRodar)
      el.removeEventListener('pointerdown', alApretar)
      window.removeEventListener('pointermove', alMover)
      window.removeEventListener('pointerup', alSoltar)
      el.removeEventListener('click', alClic, true)
    }
  }, [el])
}
