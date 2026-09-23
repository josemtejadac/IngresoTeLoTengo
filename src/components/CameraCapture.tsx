import { useEffect, useRef, useState } from 'react'

/**
 * En moviles a veces un solo toque dispara dos eventos de click casi
 * simultaneos ("ghost click"), lo que alcanzaba a generar dos fotos y dos
 * registros de asistencia antes de que React aplicara el estado "busy".
 * Por eso ademas del estado, usamos un ref: se marca de forma sincronica
 * en el mismo tick del primer click, antes de que cualquier segundo click
 * pueda pasar la validacion.
 */

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void
  onCancel: () => void
}

const MAX_WIDTH = 1024
const JPEG_QUALITY = 0.7

export function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const capturedRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function getRearCameraStream(): Promise<MediaStream> {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: 'environment' } },
          audio: false,
        })
      } catch {
        // El navegador no soporta el constraint "exact"; buscamos manualmente
        // el dispositivo cuya etiqueta indique que es la cámara trasera.
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const rearCamera = devices.find(
          (d) =>
            d.kind === 'videoinput' &&
            /back|rear|trasera|environment/i.test(d.label),
        )
        if (rearCamera) {
          return await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: rearCamera.deviceId } },
            audio: false,
          })
        }
      } catch {
        // seguimos con el siguiente intento
      }

      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
    }

    async function start() {
      try {
        const stream = await getRearCameraStream()
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch {
        setError('No se pudo acceder a la cámara. Revisa los permisos del navegador.')
      }
    }

    start()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function handleCapture() {
    if (capturedRef.current) return
    capturedRef.current = true
    setBusy(true)

    const video = videoRef.current
    if (!video) {
      capturedRef.current = false
      setBusy(false)
      return
    }

    const scale = Math.min(1, MAX_WIDTH / video.videoWidth)
    const width = Math.round(video.videoWidth * scale)
    const height = Math.round(video.videoHeight * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      capturedRef.current = false
      setBusy(false)
      return
    }
    ctx.drawImage(video, 0, 0, width, height)

    canvas.toBlob(
      (blob) => {
        if (blob) {
          // No se resetea busy/capturedRef: el boton queda deshabilitado
          // hasta que el padre termine de subir la foto y cierre este modal.
          onCapture(blob)
        } else {
          capturedRef.current = false
          setBusy(false)
        }
      },
      'image/jpeg',
      JPEG_QUALITY,
    )
  }

  return (
    <div className="camera-overlay">
      <div className="camera-modal">
        {error ? (
          <p className="camera-error">{error}</p>
        ) : (
          <>
            <p className="camera-instruction">Toma una foto al área de productos</p>
            <video ref={videoRef} className="camera-video" playsInline muted />
          </>
        )}
        <div className="camera-actions">
          <button type="button" onClick={onCancel} className="btn btn-secondary" disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleCapture}
            className="btn btn-primary"
            disabled={!!error || busy}
          >
            {busy ? 'Procesando...' : 'Tomar foto'}
          </button>
        </div>
      </div>
    </div>
  )
}
