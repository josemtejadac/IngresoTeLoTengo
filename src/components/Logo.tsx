interface LogoProps {
  size?: number
}

export function Logo({ size = 48 }: LogoProps) {
  return (
    <img
      src="/icon-512.png"
      alt="Te Lo Tengo Market"
      className="logo-img"
      width={size}
      height={size}
    />
  )
}
