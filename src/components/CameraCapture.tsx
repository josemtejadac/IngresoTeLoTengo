import { useEffect, useRef, useState } from 'react'

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

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
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
    const video = videoRef.current
    if (!video) return
    setBusy(true)

    const scale = Math.min(1, MAX_WIDTH / video.videoWidth)
    const width = Math.round(video.videoWidth * scale)
    const height = Math.round(video.videoHeight * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setBusy(false)
      return
    }
    ctx.drawImage(video, 0, 0, width, height)

    canvas.toBlob(
      (blob) => {
        setBusy(false)
        if (blob) onCapture(blob)
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
          <button type="button" onClick={onCancel} className="btn btn-secondary">
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
