import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey
    ? 'Falta configurar VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en las variables de entorno del despliegue.'
    : null

export const REMEMBER_ME_KEY = 'ingreso-remember-me'

// Si el usuario desmarca "Mantener sesión iniciada", guardamos la sesión en
// sessionStorage (se borra al cerrar el navegador) en vez de localStorage.
function currentAuthStorage(): Storage {
  return localStorage.getItem(REMEMBER_ME_KEY) === '0' ? sessionStorage : localStorage
}

const dynamicStorage = {
  getItem: (key: string) => currentAuthStorage().getItem(key),
  setItem: (key: string, value: string) => currentAuthStorage().setItem(key, value),
  removeItem: (key: string) => currentAuthStorage().removeItem(key),
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      storage: dynamicStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
)
