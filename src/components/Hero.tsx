/** 首页插画:一块带对勾的"消除板",对应参考图里的立体主视觉。 */
export function Hero() {
  return (
    <div className="hero-float" aria-hidden="true">
      <svg
        viewBox="0 0 420 380"
        className="h-[340px] w-[380px] drop-shadow-2xl"
      >
        <defs>
          <linearGradient id="board" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c9ffe2" />
            <stop offset="0.45" stopColor="#4fe09a" />
            <stop offset="1" stopColor="#0f9b62" />
          </linearGradient>
          <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#eafff4" />
            <stop offset="1" stopColor="#7df0b4" />
          </linearGradient>
          <linearGradient id="stand" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#d9f7e8" />
            <stop offset="1" stopColor="#a8e6c6" />
          </linearGradient>
          <linearGradient id="eraser" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffe98a" />
            <stop offset="1" stopColor="#ffb938" />
          </linearGradient>
        </defs>

        <ellipse
          cx="210"
          cy="352"
          rx="130"
          ry="14"
          fill="#001a12"
          opacity="0.35"
        />

        <rect
          x="150"
          y="270"
          width="120"
          height="70"
          rx="10"
          fill="url(#stand)"
        />
        <rect x="120" y="332" width="180" height="14" rx="7" fill="#e6fff2" />

        <rect x="40" y="40" width="340" height="240" rx="38" fill="url(#rim)" />
        <rect
          x="48"
          y="46"
          width="324"
          height="224"
          rx="32"
          fill="url(#board)"
        />
        <path
          d="M70 70c60-18 150-22 270-6 12 2 18 10 8 18-60 40-170 70-260 62-22-2-30-20-18-74z"
          fill="#fff"
          opacity="0.22"
        />

        <path
          d="m128 160 52 52 112-112"
          fill="none"
          stroke="#fff"
          strokeWidth="26"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <g transform="rotate(-24 330 60)">
          <rect
            x="285"
            y="36"
            width="92"
            height="46"
            rx="14"
            fill="url(#eraser)"
          />
          <rect x="285" y="36" width="34" height="46" rx="14" fill="#ff7a6b" />
        </g>
      </svg>
    </div>
  );
}
