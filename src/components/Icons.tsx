import type { ReactNode } from 'react';

type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const make = (children: ReactNode) =>
  function Icon({ className }: IconProps) {
    return (
      <svg {...base} className={className} aria-hidden="true">
        {children}
      </svg>
    );
  };

export const HomeIcon = make(
  <>
    <path d="M3.5 11 12 4l8.5 7" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M10 20v-5.5h4V20" />
  </>,
);

export const CameraIcon = make(
  <>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.4-2h5.2L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="13" r="3.4" />
  </>,
);

export const StarIcon = make(
  <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.2-4.1 5.8-.8z" />,
);

export const BookIcon = make(
  <>
    <path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v13H7.5A2.5 2.5 0 0 1 5 17.5z" />
    <path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H18" />
    <path d="M9 8.5h5" />
  </>,
);

export const GearIcon = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
  </>,
);

export const ChartIcon = make(
  <>
    <path d="M4.5 19.5h15" />
    <path d="M7 16v-4M12 16V8M17 16v-6" />
  </>,
);

export const ClockIcon = make(
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.5V12l3 2" />
  </>,
);

export const ShieldIcon = make(
  <>
    <path d="M12 3.5 5 6v5.5c0 4.3 2.8 7.2 7 9 4.2-1.8 7-4.7 7-9V6z" />
    <path d="m9 12 2.2 2.2L15.2 10" />
  </>,
);

export const SparkIcon = make(
  <>
    <path d="M12 4v4M12 16v4M4 12h4M16 12h4" />
    <path d="m7 7 2 2M15 15l2 2M17 7l-2 2M9 15l-2 2" />
  </>,
);
