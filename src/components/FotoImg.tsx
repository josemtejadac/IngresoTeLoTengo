import { useState } from 'react'

interface Props {
  src: string
  alt?: string
  className?: string
}

/**
 * Foto que aparece con un fundido recien cuando termino de cargar completa
 * (asi no se ve la imagen a medias mientras se descarga).
 */
export function FotoImg({ src, alt = '', className }: Props) {
  const [lista, setLista] = useState(false)
  return (
    <img
      src={src}
      alt={alt}
      className={`${className ?? ''} foto-img${lista ? ' foto-lista' : ''}`}
      loading="lazy"
      decoding="async"
      // Si la foto ya estaba en cache, el evento load puede haber pasado antes: se revisa al montar.
      ref={(el) => {
        if (el?.complete) setLista(true)
      }}
      onLoad={() => setLista(true)}
      onError={() => setLista(true)}
    />
  )
}
