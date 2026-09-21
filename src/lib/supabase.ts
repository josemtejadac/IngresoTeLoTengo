import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey
    ? 'Falta configurar VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en las variables de entorno del despliegue.'
    : null

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
)
