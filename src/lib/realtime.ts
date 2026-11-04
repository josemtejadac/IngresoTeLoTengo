import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

let contador = 0

/**
 * Vuelve a cargar datos cuando cambia cualquiera de las tablas indicadas (Supabase Realtime).
 * Agrupa varios cambios seguidos en una sola recarga.
 *
 * Los celulares suspenden la conexion en tiempo real al bloquear la pantalla o cambiar de app, y a veces
 * no la recuperan solos. Por eso ademas se recarga al volver a la app / recuperar internet y, si se indica
 * `cadaMs`, cada cierto tiempo como respaldo.
 */
export function useRealtimeRefresh(
  tablas: string[],
  recargar: () => void,
  cadaMs?: number,
  opciones?: {
    /** Con la pantalla oculta no pide nada y se pone al dia al volver. Nunca usarlo en pedidos: el aviso debe llegar igual. */
    soloVisible?: boolean
    /** Lo que corre en el respaldo por tiempo en lugar de `recargar` (ej. una revision mas liviana). */
    respaldo?: () => void
  },
) {
  const recargarRef = useRef(recargar)
  recargarRef.current = recargar
  const respaldoRef = useRef(opciones?.respaldo)
  respaldoRef.current = opciones?.respaldo
  const soloVisible = opciones?.soloVisible ?? false
  const clave = tablas.join(',')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let reintentoTimer: ReturnType<typeof setTimeout> | null = null
    let canal: ReturnType<typeof supabase.channel> | null = null
    let vivo = true

    const toca = () => !soloVisible || document.visibilityState === 'visible'

    const programar = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (toca()) recargarRef.current()
      }, 300)
    }

    const crearCanal = () => {
      if (!vivo) return
      const este = supabase.channel(`rt_refresh_${clave}_${++contador}`)
      canal = este
      for (const table of clave.split(',')) {
        este.on('postgres_changes', { event: '*', schema: 'public', table }, programar)
      }
      este.subscribe((estado) => {
        // Al quitar un canal, este vuelve a avisar que se cerro: ese aviso ya no cuenta
        // (si no, se quitaria una y otra vez, o se llevaria por delante al canal nuevo).
        if (!vivo || este !== canal) return
        // Si la conexion se cae o se reconecta, se pone al dia de inmediato.
        if (estado === 'SUBSCRIBED') {
          programar()
          // Si el canal se corta (celular bloqueado, red inestable), se arma uno nuevo en vez de
          // quedar mudo esperando al respaldo por tiempo o a que el usuario vuelva a la pagina.
        } else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') {
          canal = null
          supabase.removeChannel(este)
          if (reintentoTimer) clearTimeout(reintentoTimer)
          reintentoTimer = setTimeout(crearCanal, 2000)
        }
      })
    }
    crearCanal()

    const alVolver = () => {
      if (document.visibilityState === 'visible') programar()
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', programar)
    window.addEventListener('online', programar)
    const intervalo = cadaMs
      ? setInterval(() => {
          if (toca()) (respaldoRef.current ?? recargarRef.current)()
        }, cadaMs)
      : null

    return () => {
      vivo = false
      if (timer) clearTimeout(timer)
      if (reintentoTimer) clearTimeout(reintentoTimer)
      if (intervalo) clearInterval(intervalo)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', programar)
      window.removeEventListener('online', programar)
      if (canal) supabase.removeChannel(canal)
    }
  }, [clave, cadaMs, soloVisible])
}
