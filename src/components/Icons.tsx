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
    <path d="M18.85,9.78 L21.29,10.02 L21.29,13.98 L18.85,14.22 L18.42,15.27 L19.97,17.17 L17.17,19.97 L15.27,18.42 L14.22,18.85 L13.98,21.29 L10.02,21.29 L9.78,18.85 L8.73,18.42 L6.83,19.97 L4.03,17.17 L5.58,15.27 L5.15,14.22 L2.71,13.98 L2.71,10.02 L5.15,9.78 L5.58,8.73 L4.03,6.83 L6.83,4.03 L8.73,5.58 L9.78,5.15 L10.02,2.71 L13.98,2.71 L14.22,5.15 L15.27,5.58 L17.17,4.03 L19.97,6.83 L18.42,8.73 Z" />
    <circle cx="12" cy="12" r="3.2" />
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

export const RotateLeftIcon = make(
  <>
    <path d="M4 4v5h5" />
    <path d="M4.6 9A8 8 0 1 1 4 12" />
  </>,
);

export const RotateRightIcon = make(
  <>
    <path d="M20 4v5h-5" />
    <path d="M19.4 9A8 8 0 1 0 20 12" />
  </>,
);

export const ArrowUpIcon = make(<path d="M12 19V5m-6 6 6-6 6 6" />);
export const ArrowDownIcon = make(<path d="M12 5v14m-6-6 6 6 6-6" />);
export const ReplaceIcon = make(
  <>
    <path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" />
  </>,
);
export const TrashIcon = make(
  <>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
  </>,
);

export const EditIcon = make(
  <>
    <path d="m15 5 4 4M4 20l4.5-1L20 7.5a2.8 2.8 0 0 0-4-4L4.5 15z" />
  </>,
);
