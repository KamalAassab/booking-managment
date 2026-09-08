/**
 * The whole icon set.
 *
 * Hand-written rather than pulled from a package: ten glyphs weigh less than
 * the smallest library, and a fixed set cannot quietly grow into a hundred.
 *
 * Every icon is 20x20 on a 24-unit grid, 1.5 stroke, currentColor, round
 * caps and joins. None of them sits in a circle, a rounded square, a border
 * or a tinted plate — an icon sits directly on the surface beside its label.
 */

type IconProps = {
  size?: number;
  className?: string;
};

function Svg({
  size = 20,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const ChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 9l7 7 7-7" />
  </Svg>
);

export const Plus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12.5l5.5 5.5L20 7" />
  </Svg>
);

export const Close = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const Calendar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
);

export const Clock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const Phone = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h3l2 5-2.5 1.5a11 11 0 005 5L15 12l5 2v3a2 2 0 01-2.2 2A16 16 0 014 5.2 2 2 0 016 3z" />
  </Svg>
);

export const User = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M4.5 20a7.5 7.5 0 0115 0" />
  </Svg>
);

export const Power = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v8" />
    <path d="M7.5 7a7 7 0 109 0" />
  </Svg>
);

export const WhatsApp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 20.5l1.3-4.6a8 8 0 113.3 3.2l-4.6 1.4z" />
    <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5" />
  </Svg>
);
