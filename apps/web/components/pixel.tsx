type PixelProps = { className?: string };

const base = {
  viewBox: "0 0 16 16",
  shapeRendering: "crispEdges" as const,
  role: "img" as const,
  focusable: "false" as const,
};

export function PixelGrassBlock({ className }: PixelProps) {
  return (
    <svg {...base} className={className} aria-label="Блок земли">
      <rect width="16" height="16" fill="#6b4a2f" />
      <rect x="1" y="8" width="2" height="2" fill="#7a5637" />
      <rect x="5" y="10" width="3" height="2" fill="#54391f" />
      <rect x="10" y="9" width="2" height="2" fill="#7a5637" />
      <rect x="13" y="11" width="2" height="2" fill="#54391f" />
      <rect x="2" y="13" width="3" height="2" fill="#54391f" />
      <rect x="8" y="12" width="2" height="2" fill="#7a5637" />
      <rect x="12" y="7" width="1" height="1" fill="#54391f" />
      <rect x="3" y="9" width="1" height="1" fill="#54391f" />
      <rect width="16" height="6" fill="#56c247" />
      <rect y="6" width="16" height="1" fill="#37872b" />
      <rect x="1" y="1" width="2" height="2" fill="#8ae86f" />
      <rect x="6" y="2" width="2" height="2" fill="#37872b" />
      <rect x="11" y="1" width="2" height="2" fill="#8ae86f" />
      <rect x="14" y="3" width="2" height="2" fill="#37872b" />
      <rect x="3" y="4" width="3" height="2" fill="#4bad3c" />
      <rect x="9" y="4" width="3" height="2" fill="#4bad3c" />
    </svg>
  );
}

function Gem({
  className,
  light,
  base: b,
  dark,
  label,
}: PixelProps & { light: string; base: string; dark: string; label: string }) {
  return (
    <svg {...base} className={className} aria-label={label}>
      <g fill={dark}>
        <rect x="6" y="1" width="4" height="1" />
        <rect x="4" y="2" width="8" height="1" />
        <rect x="3" y="3" width="10" height="1" />
        <rect x="2" y="4" width="12" height="4" />
        <rect x="3" y="8" width="10" height="2" />
        <rect x="4" y="10" width="8" height="2" />
        <rect x="5" y="12" width="6" height="1" />
        <rect x="6" y="13" width="4" height="1" />
        <rect x="7" y="14" width="2" height="1" />
      </g>
      <g fill={b}>
        <rect x="6" y="2" width="4" height="1" />
        <rect x="4" y="3" width="8" height="1" />
        <rect x="3" y="4" width="10" height="3" />
        <rect x="4" y="7" width="8" height="2" />
        <rect x="5" y="9" width="6" height="2" />
        <rect x="6" y="11" width="4" height="1" />
        <rect x="7" y="12" width="2" height="1" />
      </g>
      <g fill={light}>
        <rect x="6" y="2" width="2" height="1" />
        <rect x="4" y="3" width="4" height="1" />
        <rect x="3" y="4" width="3" height="3" />
        <rect x="4" y="7" width="2" height="1" />
        <rect x="5" y="9" width="1" height="1" />
      </g>
    </svg>
  );
}

export function PixelDiamond({ className }: PixelProps) {
  return (
    <Gem
      className={className}
      light="#7ffcf1"
      base="#4aedd9"
      dark="#1e8f82"
      label="Алмаз"
    />
  );
}

export function PixelEmerald({ className }: PixelProps) {
  return (
    <Gem
      className={className}
      light="#7cf29a"
      base="#17dd62"
      dark="#0b7a37"
      label="Изумруд"
    />
  );
}

export function PixelGoldIngot({ className }: PixelProps) {
  return (
    <svg {...base} className={className} aria-label="Золотой слиток">
      <g fill="#d99a12">
        <rect x="3" y="5" width="10" height="1" />
        <rect x="2" y="6" width="12" height="4" />
        <rect x="3" y="10" width="10" height="1" />
        <rect x="4" y="11" width="8" height="1" />
      </g>
      <g fill="#fcc21b">
        <rect x="4" y="6" width="8" height="4" />
        <rect x="3" y="7" width="10" height="2" />
      </g>
      <g fill="#ffec8f">
        <rect x="4" y="6" width="8" height="1" />
        <rect x="3" y="7" width="3" height="1" />
      </g>
      <rect x="6" y="8" width="4" height="1" fill="#e0a916" />
    </svg>
  );
}

export function PixelClock({ className }: PixelProps) {
  return (
    <svg {...base} className={className} aria-label="Часы сезона">
      <rect x="2" y="2" width="12" height="12" fill="#d99a12" />
      <rect x="3" y="3" width="10" height="10" fill="#fcc21b" />
      <rect x="4" y="4" width="8" height="8" fill="#6fbfea" />
      <rect x="4" y="8" width="8" height="4" fill="#f5a623" />
      <rect x="4" y="4" width="8" height="1" fill="#9ad8f5" />
      <rect x="7" y="5" width="2" height="4" fill="#2e2a28" />
      <rect x="8" y="8" width="3" height="2" fill="#2e2a28" />
      <rect x="7" y="7" width="2" height="2" fill="#2e2a28" />
      <rect x="4" y="4" width="1" height="1" fill="#fff3c4" />
    </svg>
  );
}

export function PixelChest({ className }: PixelProps) {
  return (
    <svg {...base} className={className} aria-label="Сундук">
      <rect x="1" y="3" width="14" height="11" fill="#6b4726" />
      <rect x="2" y="4" width="12" height="9" fill="#a0673c" />
      <rect x="2" y="4" width="12" height="4" fill="#b07a49" />
      <rect x="2" y="7" width="12" height="1" fill="#6b4726" />
      <rect x="2" y="12" width="12" height="1" fill="#7c5433" />
      <rect x="7" y="6" width="2" height="4" fill="#3c3c3c" />
      <rect x="7" y="7" width="2" height="2" fill="#5a5a5a" />
      <rect x="3" y="4" width="2" height="1" fill="#c99a6a" />
      <rect x="1" y="3" width="14" height="1" fill="#8a5f36" />
    </svg>
  );
}

export function PixelHead({ className }: PixelProps) {
  return (
    <svg {...base} className={className} aria-label="Голова игрока">
      <rect x="3" y="2" width="10" height="12" fill="#c08961" />
      <rect x="3" y="2" width="10" height="3" fill="#33291f" />
      <rect x="3" y="5" width="2" height="3" fill="#33291f" />
      <rect x="11" y="5" width="2" height="3" fill="#33291f" />
      <rect x="3" y="13" width="10" height="1" fill="#a9764f" />
      <rect x="5" y="7" width="2" height="2" fill="#ffffff" />
      <rect x="9" y="7" width="2" height="2" fill="#ffffff" />
      <rect x="6" y="7" width="1" height="2" fill="#3e5fd9" />
      <rect x="9" y="7" width="1" height="2" fill="#3e5fd9" />
      <rect x="7" y="10" width="2" height="1" fill="#8a5b3b" />
      <rect x="5" y="11" width="6" height="1" fill="#a9764f" />
      <rect x="4" y="6" width="1" height="1" fill="#33291f" />
      <rect x="11" y="6" width="1" height="1" fill="#33291f" />
    </svg>
  );
}

export function PixelPaper({ className }: PixelProps) {
  return (
    <svg {...base} className={className} aria-label="Документ">
      <rect x="3" y="2" width="10" height="12" fill="#e8e2d0" />
      <rect x="3" y="2" width="10" height="1" fill="#ffffff" />
      <rect x="12" y="3" width="1" height="11" fill="#b7ae95" />
      <rect x="5" y="5" width="6" height="1" fill="#6b6353" />
      <rect x="5" y="7" width="6" height="1" fill="#6b6353" />
      <rect x="5" y="9" width="6" height="1" fill="#6b6353" />
      <rect x="5" y="11" width="4" height="1" fill="#6b6353" />
    </svg>
  );
}

export function PixelPickaxe({ className }: PixelProps) {
  return (
    <svg {...base} className={className} aria-label="Кирка">
      <g fill="#7a5637">
        <rect x="7" y="6" width="2" height="2" />
        <rect x="8" y="7" width="2" height="2" />
        <rect x="9" y="8" width="2" height="2" />
        <rect x="10" y="9" width="2" height="2" />
        <rect x="11" y="10" width="2" height="2" />
        <rect x="12" y="11" width="2" height="2" />
      </g>
      <g fill="#54391f">
        <rect x="8" y="7" width="1" height="1" />
        <rect x="10" y="9" width="1" height="1" />
        <rect x="12" y="11" width="1" height="1" />
      </g>
      <g fill="#9aa0a6">
        <rect x="3" y="3" width="8" height="1" />
        <rect x="2" y="4" width="3" height="1" />
        <rect x="11" y="4" width="3" height="1" />
        <rect x="1" y="5" width="2" height="1" />
        <rect x="13" y="5" width="2" height="1" />
      </g>
      <g fill="#c9ced4">
        <rect x="4" y="3" width="6" height="1" />
        <rect x="2" y="4" width="2" height="1" />
        <rect x="12" y="4" width="2" height="1" />
      </g>
      <rect x="6" y="5" width="4" height="1" fill="#6f747a" />
    </svg>
  );
}
