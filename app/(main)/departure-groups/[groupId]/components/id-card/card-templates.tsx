"use client";

import React from "react";

import {
  CameraIcon,
  CompassIcon,
  DecorativeBarcode,
  IconField,
  PalmIcon,
  PinIcon,
  PlaneIcon,
  SuitcaseIcon,
} from "./icons";

/**
 * Every colour a card draws with, named by the thing it colours rather than
 * by its hue — the studio's colour panel is generated from these keys, so a
 * token added here becomes an editable swatch without touching the panel,
 * and a template that hardcodes a colour instead of reading a token silently
 * becomes the one thing an operator cannot restyle.
 */
export interface CardPalette {
  frontBg: string;
  bandPrimary: string;
  bandSecondary: string;
  accent: string;
  brandText: string;
  photoRing: string;
  nameText: string;
  subText: string;
  metaText: string;
  backBg: string;
  labelText: string;
  valueText: string;
  footerBg: string;
  footerText: string;
}

export const PALETTE_FIELDS: {
  key: keyof CardPalette;
  label: string;
  face: "front" | "back";
}[] = [
  { key: "frontBg", label: "Background", face: "front" },
  { key: "bandPrimary", label: "Header shape", face: "front" },
  { key: "bandSecondary", label: "Header highlight", face: "front" },
  { key: "accent", label: "Accent & motifs", face: "front" },
  { key: "brandText", label: "Agency name", face: "front" },
  { key: "photoRing", label: "Photo ring", face: "front" },
  { key: "nameText", label: "Pilgrim name", face: "front" },
  { key: "subText", label: "Package line", face: "front" },
  { key: "metaText", label: "ID & date row", face: "front" },
  { key: "backBg", label: "Background", face: "back" },
  { key: "labelText", label: "Field labels", face: "back" },
  { key: "valueText", label: "Field values", face: "back" },
  { key: "footerBg", label: "Footer bar", face: "back" },
  { key: "footerText", label: "Footer text", face: "back" },
];

export interface CardData {
  photoUrl: string | null;
  name: string;
  passportNumber: string | null;
  bookingReference: string;
  groupCode: string;
  packageName: string;
  departureDateLabel: string;
  journeyLabel: string;
  agencyName: string;
  agencyLogoUrl: string | null;
  qrDataUrl: string | null;
  emergencyContactLabel: string | null;
  rooms: { city: string; hotelName: string; roomLabel: string | null }[];
  agencyContactLabel: string | null;
}

export interface FaceProps {
  data: CardData;
  p: CardPalette;
}

export interface CardTemplateDefinition {
  id: string;
  label: string;
  defaults: CardPalette;
  Front: (props: FaceProps) => React.JSX.Element;
  Back: (props: FaceProps) => React.JSX.Element;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/* ── Shared pieces ────────────────────────────────────────────────────────── */

function Wordmark({ data, p }: FaceProps) {
  if (data.agencyLogoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={data.agencyLogoUrl}
        alt=""
        style={{ height: "5mm", maxWidth: "30mm", objectFit: "contain" }}
      />
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1.4mm", minWidth: 0 }}>
      <PlaneIcon color={p.accent} style={{ width: "4.6mm", height: "4.6mm", flexShrink: 0, transform: "rotate(45deg)" }} />
      <span
        style={{
          fontSize: "2.9mm",
          fontWeight: 800,
          color: p.brandText,
          letterSpacing: "0.2px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {data.agencyName}
      </span>
    </div>
  );
}

function Photo({ data, p }: FaceProps) {
  return (
    <div
      style={{
        width: "22mm",
        height: "22mm",
        borderRadius: "50%",
        border: `0.9mm solid ${p.photoRing}`,
        overflow: "hidden",
        background: "#e5e7eb",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow: "0 0.5mm 1.4mm rgba(0,0,0,0.22)",
      }}
    >
      {data.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ fontSize: "6.5mm", fontWeight: 700, color: p.bandPrimary }}>{initials(data.name)}</span>
      )}
    </div>
  );
}

function Identity({ data, p }: FaceProps) {
  return (
    <>
      <p style={{ margin: "3.4mm 0 0", fontSize: "3.5mm", fontWeight: 800, color: p.nameText, textAlign: "center", lineHeight: 1.15 }}>
        {data.name}
      </p>
      <p style={{ margin: "0.8mm 0 0", fontSize: "2.1mm", color: p.subText, textAlign: "center", lineHeight: 1.2 }}>
        {data.packageName}
      </p>
    </>
  );
}

function MetaRow({ data, p }: FaceProps) {
  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "space-between", fontSize: "1.9mm", color: p.metaText }}>
      <span>ID {data.bookingReference}</span>
      <span>{data.departureDateLabel}</span>
    </div>
  );
}

function QrBlock({ data, p, frame }: FaceProps & { frame?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1mm" }}>
      {data.qrDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.qrDataUrl}
          alt="QR code"
          style={{
            width: "21mm",
            height: "21mm",
            border: frame ? `0.6mm solid ${frame}` : undefined,
            padding: frame ? "1mm" : undefined,
            boxSizing: "content-box",
            background: "#ffffff",
          }}
        />
      ) : (
        <div style={{ width: "21mm", height: "21mm", background: "rgba(120,120,120,0.12)" }} />
      )}
      <span style={{ fontSize: "1.7mm", color: p.labelText }}>Scan for travel details</span>
    </div>
  );
}

function BackInfo({ data, p }: FaceProps) {
  const labelStyle: React.CSSProperties = {
    margin: 0,
    fontSize: "1.9mm",
    textTransform: "uppercase",
    letterSpacing: "0.3px",
    color: p.labelText,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2mm", width: "100%" }}>
      <div>
        <p style={labelStyle}>Emergency contact</p>
        <p style={{ margin: 0, fontSize: "2.2mm", fontWeight: 600, color: p.valueText }}>
          {data.emergencyContactLabel ?? "Not on file"}
        </p>
      </div>
      <div>
        <p style={labelStyle}>Accommodation</p>
        {data.rooms.length > 0 ? (
          data.rooms.map((room, i) => (
            <p key={i} style={{ margin: 0, fontSize: "2mm", fontWeight: 600, lineHeight: 1.35, color: p.valueText }}>
              {room.hotelName}
              {room.roomLabel ? ` — Rm ${room.roomLabel}` : ""} ({room.city})
            </p>
          ))
        ) : (
          <p style={{ margin: 0, fontSize: "2mm", fontWeight: 600, color: p.valueText }}>To be assigned</p>
        )}
      </div>
      {data.passportNumber && (
        <div>
          <p style={labelStyle}>Passport</p>
          <p style={{ margin: 0, fontSize: "2.2mm", fontWeight: 600, color: p.valueText }}>{data.passportNumber}</p>
        </div>
      )}
    </div>
  );
}

function Footer({ data, p }: FaceProps) {
  return (
    <div
      style={{
        marginTop: "auto",
        marginLeft: "-5mm",
        marginRight: "-5mm",
        marginBottom: "-6mm",
        background: p.footerBg,
        padding: "2.6mm 5mm",
        textAlign: "center",
      }}
    >
      <p style={{ margin: 0, fontSize: "1.9mm", color: p.footerText, fontWeight: 700 }}>
        If found, please contact {data.agencyName}
      </p>
      <p style={{ margin: 0, fontSize: "1.8mm", color: p.footerText, opacity: 0.85 }}>
        {data.agencyContactLabel ?? ""}
      </p>
    </div>
  );
}

const faceShell: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
};

const contentShell: React.CSSProperties = {
  position: "relative",
  zIndex: 1,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  padding: "6mm 5mm",
  boxSizing: "border-box",
};

/* ── Voyage ───────────────────────────────────────────────────────────────── */

function VoyageFront({ data, p }: FaceProps) {
  return (
    <div style={{ ...faceShell, background: p.frontBg }}>
      <IconField color={p.accent} opacity={0.09} seed={0} />
      <svg viewBox="0 0 540 856" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <path d="M0 0 H540 V300 C420 340 300 250 180 300 C90 335 40 300 0 320 Z" fill={p.bandPrimary} />
        <path d="M0 0 H540 V240 C420 270 300 200 180 240 C90 265 40 250 0 260 Z" fill={p.bandSecondary} opacity="0.75" />
      </svg>
      <div style={{ ...contentShell, alignItems: "center" }}>
        <Wordmark data={data} p={p} />
        <div style={{ marginTop: "9mm" }}>
          <Photo data={data} p={p} />
        </div>
        <Identity data={data} p={p} />
        <div style={{ marginTop: "auto", width: "100%" }}>
          <MetaRow data={data} p={p} />
        </div>
      </div>
    </div>
  );
}

function VoyageBack({ data, p }: FaceProps) {
  return (
    <div style={{ ...faceShell, background: p.backBg }}>
      <svg viewBox="0 0 540 856" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <circle cx="470" cy="60" r="150" fill={p.bandPrimary} opacity="0.07" />
        <circle cx="40" cy="700" r="130" fill={p.accent} opacity="0.08" />
      </svg>
      <div style={{ ...contentShell, gap: "3mm" }}>
        <div style={{ display: "flex", justifyContent: "center", gap: "3mm" }}>
          <CameraIcon color={p.accent} style={{ width: "4.6mm", height: "4.6mm" }} />
          <SuitcaseIcon color={p.accent} style={{ width: "4.6mm", height: "4.6mm" }} />
          <CompassIcon color={p.accent} style={{ width: "4.6mm", height: "4.6mm" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <QrBlock data={data} p={p} />
        </div>
        <BackInfo data={data} p={p} />
        <Footer data={data} p={p} />
      </div>
    </div>
  );
}

/* ── Sunset ───────────────────────────────────────────────────────────────── */

function SunsetFront({ data, p }: FaceProps) {
  return (
    <div style={{ ...faceShell, background: p.frontBg }}>
      <svg viewBox="0 0 540 856" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <path d="M0 0 L230 0 L0 210 Z" fill={p.bandPrimary} />
        <path d="M540 0 L540 230 L370 0 Z" fill={p.bandSecondary} />
        <circle cx="470" cy="130" r="62" fill={p.bandSecondary} opacity="0.45" />
      </svg>
      <div style={{ ...contentShell, alignItems: "center", paddingTop: "9mm" }}>
        <Wordmark data={data} p={p} />
        <div style={{ marginTop: "7mm" }}>
          <Photo data={data} p={p} />
        </div>
        <Identity data={data} p={p} />
        <div style={{ marginTop: "auto", width: "100%" }}>
          <MetaRow data={data} p={p} />
        </div>
        <SuitcaseIcon color={p.accent} opacity={0.65} style={{ position: "absolute", bottom: "6mm", left: "3mm", width: "11mm", height: "11mm" }} />
        <PalmIcon color={p.bandSecondary} opacity={0.45} style={{ position: "absolute", bottom: "6mm", right: "3mm", width: "11mm", height: "11mm" }} />
      </div>
    </div>
  );
}

function SunsetBack({ data, p }: FaceProps) {
  return (
    <div style={{ ...faceShell, background: p.backBg }}>
      <IconField color={p.accent} opacity={0.07} seed={2} />
      <div style={{ ...contentShell, gap: "2.6mm" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "1.4mm" }}>
          <PinIcon color={p.accent} style={{ width: "4mm", height: "4mm" }} />
          <span style={{ fontSize: "1.9mm", color: p.labelText }}>{data.journeyLabel} · {data.groupCode}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <QrBlock data={data} p={p} />
        </div>
        <BackInfo data={data} p={p} />
        <Footer data={data} p={p} />
      </div>
    </div>
  );
}

/* ── Dream ────────────────────────────────────────────────────────────────── */

function DreamFront({ data, p }: FaceProps) {
  return (
    <div style={{ ...faceShell, background: p.frontBg }}>
      <svg viewBox="0 0 540 856" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <circle cx="500" cy="60" r="72" fill={p.bandPrimary} opacity="0.9" />
        <circle cx="26" cy="762" r="92" fill={p.bandPrimary} opacity="0.5" />
        <circle cx="470" cy="470" r="44" fill={p.bandSecondary} opacity="0.12" />
        {Array.from({ length: 5 }).map((_, row) =>
          Array.from({ length: 9 }).map((__, col) => (
            <circle key={`${row}-${col}`} cx={40 + col * 30} cy={250 + row * 26} r="3.4" fill={p.bandSecondary} opacity="0.28" />
          )),
        )}
      </svg>
      <div style={{ ...contentShell, alignItems: "center" }}>
        <div style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
          <Wordmark data={data} p={p} />
        </div>
        <div style={{ marginTop: "8mm" }}>
          <Photo data={data} p={p} />
        </div>
        <Identity data={data} p={p} />
        <div style={{ marginTop: "auto", width: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.9mm", color: p.metaText, marginBottom: "1.6mm" }}>
            <span>ID CARD</span>
            <span>{data.departureDateLabel}</span>
          </div>
          <div style={{ background: "rgba(255,255,255,0.94)", borderRadius: "1mm", padding: "1.4mm 2mm" }}>
            <DecorativeBarcode color="#1e293b" />
            <p style={{ margin: "0.6mm 0 0", fontSize: "2mm", fontWeight: 700, color: "#1e293b", textAlign: "center", letterSpacing: "1px" }}>
              N&deg; {data.bookingReference}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DreamBack({ data, p }: FaceProps) {
  return (
    <div style={{ ...faceShell, background: p.backBg }}>
      <svg viewBox="0 0 540 856" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <circle cx="30" cy="40" r="70" fill={p.accent} opacity="0.32" />
        <circle cx="512" cy="700" r="92" fill={p.bandSecondary} opacity="0.1" />
      </svg>
      <div style={{ ...contentShell, gap: "2.6mm" }}>
        <p style={{ margin: 0, fontSize: "2.5mm", fontWeight: 800, color: p.labelText, textAlign: "center", textTransform: "uppercase", letterSpacing: "1px" }}>
          {data.journeyLabel} Id Card
        </p>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <QrBlock data={data} p={p} frame={p.accent} />
        </div>
        <BackInfo data={data} p={p} />
        <Footer data={data} p={p} />
      </div>
    </div>
  );
}

export const CARD_TEMPLATES: CardTemplateDefinition[] = [
  {
    id: "voyage",
    label: "Voyage",
    Front: VoyageFront,
    Back: VoyageBack,
    defaults: {
      frontBg: "#eaf2fb",
      bandPrimary: "#1e3a8a",
      bandSecondary: "#2563eb",
      accent: "#1d4ed8",
      brandText: "#ffffff",
      photoRing: "#ffffff",
      nameText: "#1e293b",
      subText: "#64748b",
      metaText: "#475569",
      backBg: "#ffffff",
      labelText: "#94a3b8",
      valueText: "#1e293b",
      footerBg: "#1e3a8a",
      footerText: "#ffffff",
    },
  },
  {
    id: "sunset",
    label: "Sunset",
    Front: SunsetFront,
    Back: SunsetBack,
    defaults: {
      frontBg: "#fffaf3",
      bandPrimary: "#f97316",
      bandSecondary: "#0f766e",
      accent: "#f97316",
      brandText: "#0f766e",
      photoRing: "#0f766e",
      nameText: "#0f766e",
      subText: "#92714f",
      metaText: "#92714f",
      backBg: "#ffffff",
      labelText: "#a8a29e",
      valueText: "#44403c",
      footerBg: "#0f766e",
      footerText: "#ffffff",
    },
  },
  {
    id: "dream",
    label: "Dream",
    Front: DreamFront,
    Back: DreamBack,
    defaults: {
      frontBg: "#1d4ed8",
      bandPrimary: "#facc15",
      bandSecondary: "#ffffff",
      accent: "#facc15",
      brandText: "#ffffff",
      photoRing: "#facc15",
      nameText: "#ffffff",
      subText: "#facc15",
      metaText: "#dbeafe",
      backBg: "#ffffff",
      labelText: "#1d4ed8",
      valueText: "#1e293b",
      footerBg: "#1d4ed8",
      footerText: "#ffffff",
    },
  },
];

export function templateById(id: string): CardTemplateDefinition {
  return CARD_TEMPLATES.find((t) => t.id === id) ?? CARD_TEMPLATES[0];
}
