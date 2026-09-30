import { useEffect, useState } from 'react'
import {
  activarNotificacionesCliente,
  desactivarNotificacionesCliente,
  estadoNotificacionesCliente,
} from '../lib/pushNotificacionesCliente'

/** Para que el cliente decida si quiere que le avisen (con la app cerrada) cuando cambie el estado de este pedido. */
export function NotificacionesPedidoCliente({ pedidoId, bloque }: { pedidoId: string; bloque?: boolean }) {
  const [estado, setEstado] = useState<'cargando' | 'activadas' | 'desactivadas' | 'bloqueadas' | 'no_soportado'>(
    'cargando',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    estadoNotificacionesCliente()
      .then(setEstado)
      .catch(() => setEstado('no_soportado'))
  }, [])

  async function alternar() {
    setBusy(true)
    setError(null)
    try {
      if (estado === 'activadas') {
        await desactivarNotificacionesCliente()
        setEstado('desactivadas')
      } else {
        await activarNotificacionesCliente(pedidoId)
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

  const tamano = bloque ? '' : ' btn-small'
  return (
    <div className={bloque ? 'notif-push notif-push-bloque' : 'notif-push'}>
      <button
        type="button"
        className={(estado === 'activadas' ? 'btn btn-primary' : 'btn btn-secondary') + tamano}
        disabled={busy}
        onClick={alternar}
      >
        {busy ? '...' : estado === 'activadas' ? '🔔 Te avisaremos de este pedido' : '🔔 Avisarme de este pedido'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
