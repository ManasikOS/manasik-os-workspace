/**
 * Small line-art travel motifs shared across the ID card templates — one
 * icon set, recoloured per template, rather than a full illustration built
 * from scratch for each style. Deliberately simple strokes (no fills, no
 * gradients of their own) so they read as texture behind the card's real
 * content instead of competing with it.
 */
import type { CSSProperties } from "react";

interface IconProps {
  color: string;
  opacity?: number;
  style?: CSSProperties;
}

export function PlaneIcon({ color, opacity = 1, style }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={style}>
      <path
        d="M44 24 30 18 27 6l-4 1 2 12-10-2-3-4-3 1 3 6-4 3 1 3 6-1 1 6 3-1 1-11 12 3z"
        fill={color}
        opacity={opacity}
      />
    </svg>
  );
}

export function CompassIcon({ color, opacity = 1, style }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={style}>
      <circle cx="24" cy="24" r="18" stroke={color} strokeWidth="2.4" opacity={opacity} />
      <path d="M31 17 21 21l-4 10 10-4z" fill={color} opacity={opacity} />
    </svg>
  );
}

export function CameraIcon({ color, opacity = 1, style }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={style}>
      <rect x="6" y="14" width="36" height="24" rx="4" stroke={color} strokeWidth="2.4" opacity={opacity} />
      <path d="M17 14l3-5h8l3 5" stroke={color} strokeWidth="2.4" opacity={opacity} />
      <circle cx="24" cy="26" r="7" stroke={color} strokeWidth="2.4" opacity={opacity} />
    </svg>
  );
}

export function SuitcaseIcon({ color, opacity = 1, style }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={style}>
      <rect x="8" y="16" width="32" height="24" rx="3" stroke={color} strokeWidth="2.4" opacity={opacity} />
      <path d="M18 16v-4a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v4" stroke={color} strokeWidth="2.4" opacity={opacity} />
      <path d="M8 26h32" stroke={color} strokeWidth="2.4" opacity={opacity} />
    </svg>
  );
}

export function PalmIcon({ color, opacity = 1, style }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={style}>
      <path d="M24 42V22" stroke={color} strokeWidth="2.4" opacity={opacity} />
      <path
        d="M24 22c-3-8-11-9-16-6 4 6 10 7 16 6zM24 22c3-8 11-9 16-6-4 6-10 7-16 6zM24 20c-1-7 3-12 7-14-1 7-3 12-7 14zM24 20c1-6-1-11-5-14 1 6 2 11 5 14z"
        fill={color}
        opacity={opacity}
      />
    </svg>
  );
}

export function PinIcon({ color, opacity = 1, style }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" style={style}>
      <path
        d="M24 6c-7 0-13 5.5-13 13 0 9.5 13 23 13 23s13-13.5 13-23c0-7.5-6-13-13-13z"
        stroke={color}
        strokeWidth="2.4"
        opacity={opacity}
      />
      <circle cx="24" cy="19" r="5" fill={color} opacity={opacity} />
    </svg>
  );
}

/** A field of faint icons, evenly spread and independently rotated — texture, not a scene. */
export function IconField({
  color,
  opacity,
  seed = 0,
}: {
  color: string;
  opacity: number;
  seed?: number;
}) {
  const icons = [PlaneIcon, CompassIcon, CameraIcon, SuitcaseIcon, PalmIcon, PinIcon];
  const positions = [
    { top: "6%", left: "72%", size: 30, rot: -12 },
    { top: "18%", left: "10%", size: 24, rot: 18 },
    { top: "58%", left: "82%", size: 26, rot: 8 },
    { top: "70%", left: "6%", size: 28, rot: -20 },
    { top: "38%", left: "48%", size: 20, rot: 30 },
    { top: "84%", left: "44%", size: 22, rot: -6 },
  ];
  return (
    <>
      {positions.map((pos, i) => {
        const Icon = icons[(i + seed) % icons.length];
        return (
          <Icon
            key={i}
            color={color}
            opacity={opacity}
            style={{
              position: "absolute",
              top: pos.top,
              left: pos.left,
              width: pos.size,
              height: pos.size,
              transform: `rotate(${pos.rot}deg)`,
              pointerEvents: "none",
            }}
          />
        );
      })}
    </>
  );
}

/** A decorative barcode — visual texture matching a ticket/boarding-pass
 *  motif, not a functional symbology; the QR code is the one scannable code
 *  on the card. */
export function DecorativeBarcode({ color }: { color: string }) {
  const widths = [2, 1, 3, 1, 1, 2, 3, 1, 2, 1, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1];
  let x = 0;
  return (
    <svg viewBox="0 0 120 28" style={{ width: "100%", height: "auto" }}>
      {widths.map((w, i) => {
        const bar = <rect key={i} x={x} y={0} width={w} height={20} fill={color} />;
        x += w + 1.4;
        return bar;
      })}
    </svg>
  );
}
