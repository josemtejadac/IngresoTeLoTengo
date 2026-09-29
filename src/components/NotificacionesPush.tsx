import { useEffect, useState } from 'react'
import {
  activarNotificaciones,
  desactivarNotificaciones,
  estadoNotificaciones,
} from '../lib/pushNotificaciones'

/** Boton para activar/desactivar los avisos de pedidos nuevos en este dispositivo (funcionan con la app cerrada). */
export function NotificacionesPush() {
  const [estado, setEstado] = useState<'cargando' | 'activadas' | 'desactivadas' | 'bloqueadas' | 'no_soportado'>(
    'cargando',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    estadoNotificaciones()
      .then(setEstado)
      .catch(() => setEstado('no_soportado'))
  }, [])

  async function alternar() {
    setBusy(true)
    setError(null)
    try {
      if (estado === 'activadas') {
        await desactivarNotificaciones()
        setEstado('desactivadas')
      } else {
        await activarNotificaciones()
        setEstado('activadas')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar las notificaciones')
    } finally {
      setBusy(false)
    }
  }

  if (estado === 'no_soportado' || estado === 'cargando') return null

  if (estado === 'bloqueadas') {
    return (
      <span className="subtitle notif-bloqueadas" title="Actívalas desde el candado/permisos del navegador">
        🔕 Notificaciones bloqueadas
      </span>
    )
  }

  return (
    <div className="notif-push">
      <button
        type="button"
        className={estado === 'activadas' ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}
        disabled={busy}
        onClick={alternar}
      >
        {busy ? '...' : estado === 'activadas' ? '🔔 Notificaciones activadas' : '🔕 Activar notificaciones'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
