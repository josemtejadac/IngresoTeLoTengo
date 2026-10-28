/** Silueta negra de murcielago (tema Halloween de la tienda). El ancho se controla con CSS. */
export function Murcielago({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 50" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M50 44 L56 40 L62 30 L68 34 L75 26 L82 30 L86 20 L92 22 L98 12 Q86 4 72 12 Q62 16 57 16 L55 6 L52 13 L50 12 L48 13 L45 6 L43 16 Q38 16 28 12 Q14 4 2 12 L8 22 L14 20 L18 30 L25 26 L32 34 L38 30 L44 40 Z"
      />
    </svg>
  )
}
