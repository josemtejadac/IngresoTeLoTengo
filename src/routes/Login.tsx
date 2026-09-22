import { useEffect, useState } from 'react'
import { REMEMBER_ME_KEY, supabase } from '../lib/supabase'
import { Logo } from '../components/Logo'

const EMAIL_DOMAIN = 'ingresotelotengo.local'

interface DirectoryEntry {
  full_name: string
  rut: string
}

export function Login() {
  const [directory, setDirectory] = useState<DirectoryEntry[]>([])
  const [selectedRut, setSelectedRut] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
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
    localStorage.setItem(REMEMBER_ME_KEY, remember ? '1' : '0')
    const email = `${selectedRut}@${EMAIL_DOMAIN}`
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError('Contraseña incorrecta.')
  }

  return (
    <div className="page-center">
      <form onSubmit={handleSubmit} className="card login-form">
        <div className="login-brand">
          <Logo size={72} />
          <h1>Te Lo Tengo Market</h1>
        </div>
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
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Mantener sesión iniciada
        </label>

        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={loading || !selectedRut}>
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}
