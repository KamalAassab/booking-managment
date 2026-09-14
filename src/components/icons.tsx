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

export const RotateCcw = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
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

export const Grid = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);

export const Briefcase = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5.5A2.5 2.5 0 0110.5 3h3A2.5 2.5 0 0116 5.5V7" />
  </Svg>
);

export const OwnerAvatarIcon = ({ size = 20, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 14v2a6 6 0 0 0-6 6H4a8 8 0 0 1 8-8zm0-1c-3.315 0-6-2.685-6-6s2.685-6 6-6 6 2.685 6 6-2.685 6-6 6zm0-2c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm9 6h1v5h-8v-5h1v-1a3 3 0 0 1 6 0v1zm-2 0v-1a1 1 0 0 0-2 0v1h2z" />
  </svg>
);

export const Bell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
  </Svg>
);

export const Search = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
  </Svg>
);

export const Eye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const EyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
    <path d="M3 3l18 18" />
  </Svg>
);

export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);

export const Sun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="5" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </Svg>
);

export const Moon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
  </Svg>
);

export const SalonSilverIcon = ({ size = 20, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 512 512"
    fill="currentColor"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <g>
      <path d="M149.333,358.426c-5.888,0-10.667,4.779-10.667,10.667c0,5.888,4.779,10.667,10.667,10.667S160,374.981,160,369.093 S155.221,358.426,149.333,358.426z" />
      <path d="M405.333,123.76c-5.888,0-10.667,4.779-10.667,10.667s4.779,10.667,10.667,10.667c5.888,0,10.667-4.779,10.667-10.667 S411.221,123.76,405.333,123.76z" />
      <path d="M480.235,113.114h-18.965c5.291-7.616,12.416-18.88,17.109-26.389c1.792-2.901,2.112-6.485,0.832-9.643 s-3.989-5.504-7.296-6.336c-29.739-7.445-61.056,1.835-81.813,24.192c-3.712,4.011-9.621,10.283-17.152,18.155H74.667 C33.493,113.093,0,146.586,0,187.76c0,5.888,4.779,10.667,10.667,10.667h256c5.888,0,10.581-4.437,10.603-10.325 c0.149-0.299,3.605-5.739,30.144-9.664c-60.373,57.728-142.784,129.6-217.451,170.923c-13.163,7.296-22.336,19.947-25.088,34.709 c-2.773,14.784,1.173,29.888,10.816,41.451l0.043,0.064c9.899,11.883,24.192,18.197,38.699,18.197 c8.512,0,17.088-2.176,24.896-6.699c65.003-37.397,189.12-136.853,280.256-262.08c11.243,0.256,22.101,0.576,31.915,0.853 c10.752,0.341,20.352,0.64,28.181,0.768h0.555c8.384,0,16.277-3.221,22.272-9.088c6.123-6.037,9.493-14.08,9.493-22.656 C512,127.365,497.749,113.114,480.235,113.114z M258.859,177.093H22.4c4.971-24.32,26.496-42.667,52.267-42.667h277.483 c-6.315,6.4-13.035,13.12-20.096,20.075C300.032,156.528,268.352,161.178,258.859,177.093z M432.171,118.106 c-8.747,13.952-17.728,27.371-26.709,39.851c-0.043,0.043-0.021,0.128-0.064,0.171 C316.096,282.65,192.853,381.701,128.683,418.629c-12.16,6.997-27.52,4.181-36.565-6.699l-0.043-0.064 c-5.547-6.677-7.829-15.36-6.229-23.851c1.6-8.491,6.869-15.787,14.464-19.989c127.701-70.677,276.843-227.776,305.429-258.56 c11.904-12.821,28.48-19.861,45.589-19.904c-5.099,7.872-9.557,14.507-10.88,16c-0.619,0.619-1.152,1.28-1.6,2.027 c-2.133,3.541-4.459,6.976-6.656,10.496C432.192,118.106,432.171,118.106,432.171,118.106z M487.552,152.282 c-2.027,1.984-4.672,2.645-7.509,2.987c-7.744-0.128-17.259-0.427-27.904-0.747c-5.675-0.149-11.669-0.341-17.899-0.512 c0.064-0.085,0.107-0.171,0.171-0.256c4.309-6.336,8.469-12.757,12.587-19.2c0.043-0.043,0.064-0.107,0.107-0.149h33.131 c5.76,0,10.432,4.672,10.432,10.432C490.667,147.674,489.557,150.298,487.552,152.282z" />
      <path d="M298.667,241.093c-5.888,0-10.667,4.779-10.667,10.667c0,5.888,4.779,10.667,10.667,10.667s10.667-4.779,10.667-10.667 C309.333,245.872,304.555,241.093,298.667,241.093z" />
    </g>
  </svg>
);

export const SalonGoldIcon = ({ size = 20, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M20.61,4.36H18a17.16,17.16,0,0,1-8-2.2A5.73,5.73,0,1,0,7.25,13a5.6,5.6,0,0,0,2.9-.79,16.26,16.26,0,0,1,8.29-2.07h2.17Z" />
    <line x1="20.61" y1="2.45" x2="20.61" y2="12" />
    <circle cx="7.25" cy="7.23" r="1.91" />
    <line x1="11.07" y1="7.23" x2="14.89" y2="7.23" />
    <path d="M4.67,12.33l1.22,5.48a2.32,2.32,0,0,0,2.28,1.83,2.36,2.36,0,0,0,.75-.13,2.32,2.32,0,0,0,1.52-2.71l-1-4.3" />
    <path d="M8.92,19.51l.5,1.24A2.77,2.77,0,0,0,12,22.5h.12a2.78,2.78,0,0,0,2.78-2.78V17.25a2.38,2.38,0,0,1,2.38-2.39h0a2.39,2.39,0,0,1,2.39,2.39h0A3.33,3.33,0,0,0,23,20.59h.48" />
  </svg>
);

export const SalonVipIcon = ({ size = 20, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 502.519 502.519"
    fill="currentColor"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <g transform="translate(1 1)">
      <path d="M316.63,425.667H183.889c-5.689,0-9.482,3.793-9.482,9.482c0,5.689,3.793,9.481,9.482,9.481H316.63 c5.689,0,9.482-3.793,9.482-9.481C326.111,429.459,322.319,425.667,316.63,425.667z" />
      <path d="M316.63,387.741H183.889c-5.689,0-9.482,3.793-9.482,9.481c0,5.689,3.793,9.482,9.482,9.482H316.63 c5.689,0,9.482-3.793,9.482-9.482C326.111,391.533,322.319,387.741,316.63,387.741z" />
      <path d="M352.308,132.415c-4.202-40.565-14.967-83.024-41.368-128.674C309.044,0.896,306.2-1,302.407-1H199.059 c-3.793,0-6.637,1.896-8.533,4.741c-25.821,43.572-36.989,86.838-41.649,128.242c-32.047,21.021-50.321,56.404-50.321,93.625 v152.652c0,68.267,54.993,123.259,123.259,123.259h56.889c68.267,0,123.259-54.993,123.259-123.259V225.607 C401.963,187.72,383.944,153.442,352.308,132.415z M203.8,17.963v0.948h91.97c30.962,53.479,38.421,102.78,39.822,150.229v48.882 v26.548v8.533c0,37.926-30.341,68.267-68.267,68.267h-34.133c-37.926,0-68.267-30.341-68.267-68.267v-8.533v-21.807v-45.664 C166.201,126.588,173.385,72.276,203.8,17.963z M383,378.259c0,57.837-46.459,104.296-104.296,104.296h-56.889 c-57.837,0-104.296-46.459-104.296-104.296V225.607c0-25.6,10.43-50.252,28.444-67.319c0,0,0,12.853,0,18.867 c-0.373,15.608-0.211,30.843,0,45.607c0,9.491,0,18.235,0,21.807c0,1.398,0,8.533,0,8.533c0,3.778,0.237,7.498,0.698,11.146 c0.184,1.459,0.404,2.907,0.659,4.342c0.127,0.718,0.263,1.432,0.408,2.144c8.102,39.835,43.154,69.598,85.465,69.598h34.133 c21.156,0,40.496-7.441,55.561-19.861c0.538-0.444,1.071-0.894,1.598-1.35c1.054-0.912,2.086-1.85,3.094-2.811 c1.009-0.961,1.994-1.947,2.955-2.955c1.442-1.513,2.83-3.078,4.161-4.692c0.444-0.538,0.881-1.081,1.312-1.63 c0.862-1.098,1.697-2.217,2.506-3.356c0.809-1.139,1.591-2.299,2.346-3.479s1.481-2.379,2.18-3.596 c0.349-0.609,0.691-1.222,1.026-1.841c0.67-1.236,1.31-2.491,1.921-3.762c5.496-11.446,8.571-24.296,8.571-37.896v-8.533v-26.548 c0.234-16.408,0.468-32.99,0-49.846v-9.887C372.57,176.304,383,200.007,383,225.607V378.259z" />
    </g>
  </svg>
);

export const SalonGlyph = ({
  slug,
  size = 18,
  className,
}: {
  slug: string;
  size?: number;
  className?: string;
}) => {
  if (slug === "vip") return <SalonVipIcon size={size} className={className} />;
  if (slug === "gold") return <SalonGoldIcon size={size} className={className} />;
  return <SalonSilverIcon size={size} className={className} />;
};

