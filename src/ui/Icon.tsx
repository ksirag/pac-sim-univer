import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  activity: <><circle cx="13" cy="4.5" r="2" /><path d="M7 21l3-7 3 3 1 4M10 14l-2-4 4-2 3 3 3 1M8 10l-3 2" /></>,
  route: <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 000-6H9a3 3 0 010-6h6.5" /></>,
  history: <><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></>,
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h9" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></>,
  download: <><path d="M12 4v11M7 11l5 5 5-5" /><path d="M5 20h14" /></>,
  upload: <><path d="M12 16V5M7 9l5-5 5 5" /><path d="M5 20h14" /></>,
  pin: <><path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  draw: <><path d="M3 21c3 0 4-3 6-3s2 3 5 0 1-9 6-14" /><path d="M16 4l4 4" /></>,
  road: <><path d="M8 3l-3 18M16 3l3 18M12 4v3M12 11v3M12 18v3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.01" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  walk: <><circle cx="13" cy="4.5" r="2" /><path d="M10 21l1.5-6-2.5-2 2-5 3 3 3 1M9 12l-2 3" /></>,
  run: <><circle cx="14" cy="4.5" r="2" /><path d="M5 21l4-5 3 1.5 1-5-3-2-3 3M13 12l3 3 3 1M9 8l3-1.5" /></>,
  share: <><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></>,
  repeat: <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 01-3 3H3" /></>,
  wifiOff: <><path d="M2 8.8A15 15 0 0112 5c1.3 0 2.5.2 3.7.5M5 12.5a10 10 0 015-2.5M8.5 16a5 5 0 013-1.4" /><path d="M12 20h.01M3 3l18 18" /></>,
  locate: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  more: <><circle cx="5" cy="12" r="1.5" fill="currentColor" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><circle cx="19" cy="12" r="1.5" fill="currentColor" /></>,
  loop: <><path d="M4 12a8 8 0 018-8h4M20 12a8 8 0 01-8 8H8" /><path d="M14 1l3 3-3 3M10 17l-3 3 3 3" /></>,
  home: <><path d="M4 11l8-7 8 7v9H4z" /><path d="M10 20v-6h4v6" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
