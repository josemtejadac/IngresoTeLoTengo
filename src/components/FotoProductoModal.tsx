import { useEffect, useRef, useState } from 'react'
import {
  componerFondoBlanco,
  quitarFondo,
  reactivarRecorte,
  recorteActivo,
  revisarCaidaPrevia,
} from '../lib/fondoBlanco'

interface Props {
  nombre: string
  file: File
  /** Sube la imagen elegida: el resultado con fondo blanco, o null para usar la original. */
  onUsar: (resultado: Blob | null) => Promise<void>
  onCancelar: () => void
}

/** Muestra la foto original y la version con fondo blanco para elegir cual guardar. */
export function FotoProductoModal({ nombre, file, onUsar, onCancelar }: Props) {
  const [original] = useState(() => URL.createObjectURL(file))
  // Debe evaluarse antes de cualquier intento nuevo: detecta si el anterior cerro la pagina.
  const [activo, setActivo] = useState(() => {
    revisarCaidaPrevia()
    return recorteActivo()
  })
  const [resultado, setResultado] = useState<Blob | null>(null)
  const [resultadoUrl, setResultadoUrl] = useState<string | null>(null)
  const [progreso, setProgreso] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const vivo = useRef(true)

  useEffect(() => {
    if (!activo) return
    vivo.current = true
    ;(async () => {
      try {
        const recorte = await quitarFondo(file, (p) => {
          if (vivo.current) setProgreso(p)
        })
        const compuesta = await componerFondoBlanco(recorte)
        if (!vivo.current) return
        setResultado(compuesta)
        setResultadoUrl(URL.createObjectURL(compuesta))
      } catch (err) {
        if (vivo.current) {
          setError(err instanceof Error ? err.message : 'No se pudo quitar el fondo')
        }
      }
    })()
    return () => {
      vivo.current = false
    }
  }, [file, activo])

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(original)
    }
  }, [original])

  useEffect(() => {
    return () => {
      if (resultadoUrl) URL.revokeObjectURL(resultadoUrl)
    }
  }, [resultadoUrl])

  async function usar(blob: Blob | null) {
    if (guardando) return
    setGuardando(true)
    try {
      await onUsar(blob)
    } finally {
      setGuardando(false)
    }
  }

  const procesando = activo && resultado === null && error === null

  return (
    <div className="camera-overlay">
      <div className="camera-modal">
        <div className="modal-top">
          <button type="button" className="btn btn-secondary btn-small" onClick={onCancelar} disabled={guardando}>
            ← Cancelar
          </button>
          <h2>Foto de {nombre}</h2>
        </div>

        <div className="foto-comparar">
          <figure>
            <img src={original} alt="Original" />
            <figcaption>Original</figcaption>
          </figure>
          <figure>
            {resultadoUrl ? (
              <img src={resultadoUrl} alt="Con fondo blanco" className="foto-blanca" />
            ) : (
              <div className="foto-espera">
                {procesando ? 'Quitando el fondo…' : 'No disponible'}
              </div>
            )}
            <figcaption>Fondo blanco</figcaption>
          </figure>
        </div>

        {procesando && (
          <p className="subtitle">
            {progreso > 0 ? `Preparando… ${progreso}%. ` : ''}La primera vez tarda más porque
            descarga el programa de recorte (queda guardado después).
          </p>
        )}
        {!activo && (
          <p className="subtitle">
            El recorte automático está desactivado en este teléfono, porque la página se cerraba
            al procesar la foto. Puedes usar la foto original.{' '}
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                reactivarRecorte()
                setActivo(true)
              }}
            >
              Volver a intentarlo
            </button>
          </p>
        )}
        {error && (
          <p className="error-text">
            No se pudo quitar el fondo ({error}). Puedes usar la foto original.
          </p>
        )}

        <div className="camera-actions">
          <button
            className="btn btn-secondary"
            disabled={guardando}
            onClick={() => usar(null)}
          >
            Usar la original
          </button>
          <button
            className="btn btn-primary"
            disabled={guardando || resultado === null}
            onClick={() => usar(resultado)}
          >
            {guardando ? 'Guardando...' : 'Usar fondo blanco'}
          </button>
        </div>
      </div>
    </div>
  )
}
