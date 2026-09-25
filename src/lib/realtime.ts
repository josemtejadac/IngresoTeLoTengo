import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

let contador = 0

/**
 * Vuelve a cargar datos cuando cambia cualquiera de las tablas indicadas (Supabase Realtime).
 * Agrupa varios cambios seguidos en una sola recarga.
 */
export function useRealtimeRefresh(tablas: string[], recargar: () => void) {
  const recargarRef = useRef(recargar)
  recargarRef.current = recargar
  const clave = tablas.join(',')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const canal = supabase.channel(`rt_refresh_${clave}_${++contador}`)
    for (const table of clave.split(',')) {
      canal.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => recargarRef.current(), 300)
      })
    }
    canal.subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(canal)
    }
  }, [clave])
}
