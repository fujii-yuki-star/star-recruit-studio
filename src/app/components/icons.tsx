// シンプルなラインアイコン集（絵文字は使わない）。
import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

function base(size: number, className?: string, style?: CSSProperties) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    style,
  };
}

export function HomeIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

export function FolderIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

export function LayoutIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

export function SettingsIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function HelpIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function MailIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export function BellIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function PlusIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function PlayIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M7 5v14l11-7z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StopIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PhotoIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 16-5-5L5 20" />
    </svg>
  );
}

export function VideoIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  );
}

export function MusicIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M9 18V5l10-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </svg>
  );
}

export function SearchIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function CheckIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

export function SparkleIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TrashIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  );
}

export function SaveIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M8 4v5h7M8 21v-6h8v6" />
    </svg>
  );
}

export function PencilIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  );
}

export function UploadIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function VolumeIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M16 9a3 3 0 0 1 0 6M19 7a6 6 0 0 1 0 10" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function FilmIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg {...base(size, className, style)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </svg>
  );
}
