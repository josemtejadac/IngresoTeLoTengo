import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from '../types'

const PERFIL_KEY = 'tlt-perfil-cache-v1'

function leerPerfilGuardado(userId: string): Profile | null {
  try {
    const raw = localStorage.getItem(PERFIL_KEY)
    const p = raw ? (JSON.parse(raw) as Profile) : null
    return p && p.id === userId ? p : null
  } catch {
    return null
  }
}

/** La sesion que dejo guardada el navegador (sirve cuando no hay señal y no se puede renovar el pase). */
function sesionGuardada(): Session | null {
  for (const almacen of [localStorage, sessionStorage]) {
    try {
      for (let i = 0; i < almacen.length; i++) {
        const k = almacen.key(i)
        if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
          const s = JSON.parse(almacen.getItem(k) ?? 'null') as Session | null
          if (s?.user?.id) return s
        }
      }
    } catch {
      // se ignora y se prueba el otro almacen
    }
  }
  return null
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function loadProfile(userId: string) {
      try {
        const consulta = supabase.from('ingreso_profiles').select('*').eq('id', userId).single()
        const { data, error } = await Promise.race([
          Promise.resolve(consulta),
          new Promise<never>((_, rechazar) => setTimeout(() => rechazar(new Error("sin respuesta")), 3000)),
        ])
        if (error) throw error
        const p = (data as Profile) ?? null
        if (active) setProfile(p)
        if (p) {
          try {
            localStorage.setItem(PERFIL_KEY, JSON.stringify(p))
          } catch {
            // sin almacenamiento
          }
        }
      } catch {
        // Sin señal: se usa el perfil que quedo guardado en vez de dejar al trabajador sin pantalla.
        if (active) setProfile(leerPerfilGuardado(userId))
      }
    }

    /**
     * Sin señal, si el pase de sesion estaba vencido no se puede renovar y getSession devuelve "sin sesion":
     * eso mandaba al trabajador a la pantalla de inicio y se le "perdian" los pedidos. Si el navegador tiene la
     * sesion guardada, se sigue usando mientras no haya señal; cuando vuelve internet se renueva sola.
     */
    function resolverSesion(real: Session | null): Session | null {
      if (real) return real
      return sesionGuardada()
    }

    // Con señal muy mala la conexion a veces no falla: se queda colgada. Se espera maximo 4 s y se sigue
    // con la sesion guardada en el telefono (si despues llega internet, se confirma sola).
    const esperaMaxima = new Promise<{ data: { session: Session | null } }>((resolve) =>
      setTimeout(() => resolve({ data: { session: null } }), 3000),
    )
    Promise.race([supabase.auth.getSession(), esperaMaxima])
      .then(({ data }) => {
        if (!active) return
        const s = resolverSesion(data.session)
        setSession(s)
        if (s) {
          loadProfile(s.user.id).finally(() => active && setLoading(false))
        } else {
          setLoading(false)
        }
      })
      .catch(() => {
        // Con mala señal, getSession puede fallar en vez de demorarse: se usa la sesion guardada si existe.
        if (!active) return
        const s = sesionGuardada()
        setSession(s)
        if (s) loadProfile(s.user.id).finally(() => active && setLoading(false))
        else setLoading(false)
      })

    const { data: sub } = supabase.auth.onAuthStateChange((evento, newSession) => {
      if (evento === 'SIGNED_OUT') {
        // Cerrar sesion de verdad (boton) siempre limpia todo.
        setSession(null)
        setProfile(null)
        try {
          localStorage.removeItem(PERFIL_KEY)
        } catch {
          // sin almacenamiento
        }
        return
      }
      const s = newSession ?? (navigator.onLine === false ? sesionGuardada() : null)
      setSession(s)
      if (s) {
        loadProfile(s.user.id)
      } else {
        setProfile(null)
      }
    })

    // Al volver internet se confirma la sesion real (si de verdad se cerro, se vuelve a pedir el inicio).
    const alVolverInternet = () => {
      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (!active) return
          if (data.session) {
            setSession(data.session)
          } else if (!sesionGuardada()) {
            setSession(null)
            setProfile(null)
          }
        })
        .catch(() => {})
    }
    window.addEventListener('online', alVolverInternet)

    return () => {
      active = false
      sub.subscription.unsubscribe()
      window.removeEventListener('online', alVolverInternet)
    }
  }, [])

  return { session, profile, loading }
}
