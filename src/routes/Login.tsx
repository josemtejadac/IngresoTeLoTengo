import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const EMAIL_DOMAIN = 'ingresotelotengo.local'

interface DirectoryEntry {
  full_name: string
  rut: string
}

export function Login() {
  const [directory, setDirectory] = useState<DirectoryEntry[]>([])
  const [selectedRut, setSelectedRut] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingDirectory, setLoadingDirectory] = useState(true)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.rpc('ingreso_login_directory')
      if (!error && data) {
        setDirectory(data as DirectoryEntry[])
        if (data.length > 0) setSelectedRut((data as DirectoryEntry[])[0].rut)
      }
      setLoadingDirectory(false)
    }
    load()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedRut) return
    setLoading(true)
    setError(null)
    const email = `${selectedRut}@${EMAIL_DOMAIN}`
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError('Contraseña incorrecta.')
  }

  return (
    <div className="page-center">
      <form onSubmit={handleSubmit} className="card login-form">
        <h1>Ingreso Te Lo Tengo</h1>
        <p className="subtitle">Selecciona tu nombre e ingresa tu contraseña</p>

        {loadingDirectory ? (
          <p>Cargando...</p>
        ) : (
          <label>
            Nombre
            <select value={selectedRut} onChange={(e) => setSelectedRut(e.target.value)} required>
              {directory.map((d) => (
                <option key={d.rut} value={d.rut}>
                  {d.full_name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          Contraseña
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={loading || !selectedRut}>
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}
