"use client";

import PageHeader from "@/components/page-header";
import SectionHeading from "@/components/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  ArrowLeft,
  Minus,
  Palette,
  Plus,
  Printer,
  RotateCcw,
  Sparkles,
  Upload,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { formatDate } from "../../../utils";
import {
  CARD_TEMPLATES,
  PALETTE_FIELDS,
  templateById,
  type CardData,
  type CardPalette,
} from "./card-templates";

export interface IdCardStudioData {
  groupId: string;
  agency: {
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string | null;
    whatsapp: string | null;
    officeAddress: string | null;
  };
  group: {
    groupCode: string;
    groupName: string;
    departureDate: string;
    returnDate: string;
    journeyType: "UMRAH" | "HAJJ" | "EARLY_REGISTRATION";
    packageName: string;
  };
  pilgrim: {
    fullName: string;
    passportNumber: string | null;
    phone: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    bookingReference: string;
    rooms: { city: string; hotelName: string; roomLabel: string | null }[];
  };
}

const CITY_LABELS: Record<string, string> = {
  MAKKAH: "Makkah",
  MADINAH: "Madinah",
  MINA: "Mina",
  ARAFAT: "Arafat",
  OTHER: "Other",
};

const JOURNEY_LABELS: Record<IdCardStudioData["group"]["journeyType"], string> =
  {
    HAJJ: "Hajj",
    UMRAH: "Umrah",
    EARLY_REGISTRATION: "Early Registration",
  };

/** Design choices outlive one card: the next pilgrim on the same group should
 *  print on the same design without re-picking it. Kept in the browser rather
 *  than on the agency record because it is a print preference, not agency
 *  data — an agency-wide saved design would be a settings field, not this. */
const STORAGE_KEY = "raf.id-card.design.v1";

interface StoredDesign {
  templateId: string;
  palettes: Record<string, Partial<CardPalette>>;
}

const DEFAULT_DESIGN: StoredDesign = {
  templateId: CARD_TEMPLATES[0].id,
  palettes: {},
};

/* The saved design is read through `useSyncExternalStore` rather than copied
 * into state on mount: localStorage is an external store, and treating it as
 * one keeps the server's first render (defaults) and the client's (whatever
 * was saved) reconciled by React instead of by an effect that writes state. */
const designListeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedDesign: StoredDesign = DEFAULT_DESIGN;

function subscribeDesign(onChange: () => void): () => void {
  designListeners.add(onChange);
  // Another tab editing the same design should not leave this one stale.
  window.addEventListener("storage", onChange);
  return () => {
    designListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readDesign(): StoredDesign {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing: fall through to the default design.
  }
  if (raw === cachedRaw) return cachedDesign;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as StoredDesign) : DEFAULT_DESIGN;
    cachedDesign = {
      templateId: parsed.templateId ?? DEFAULT_DESIGN.templateId,
      palettes: parsed.palettes ?? {},
    };
  } catch {
    cachedDesign = DEFAULT_DESIGN;
  }
  return cachedDesign;
}

function serverDesign(): StoredDesign {
  return DEFAULT_DESIGN;
}

function writeDesign(next: StoredDesign): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or private browsing — the design just won't outlive this page.
  }
  for (const listener of designListeners) listener();
}

const subscribeClient = () => () => {};

function buildQrText(data: IdCardStudioData, printedName: string): string {
  const { agency, group, pilgrim } = data;
  return [
    `PILGRIM: ${printedName}`,
    pilgrim.passportNumber ? `PASSPORT: ${pilgrim.passportNumber}` : null,
    pilgrim.phone ? `PHONE: ${pilgrim.phone}` : null,
    `BOOKING: ${pilgrim.bookingReference}`,
    `GROUP: ${group.groupCode} - ${group.groupName}`,
    pilgrim.emergencyContactName
      ? `EMERGENCY CONTACT: ${pilgrim.emergencyContactName}${
          pilgrim.emergencyContactPhone
            ? ` (${pilgrim.emergencyContactPhone})`
            : ""
        }`
      : null,
    ...pilgrim.rooms.map(
      (room) =>
        `${CITY_LABELS[room.city] ?? room.city}: ${room.hotelName}${
          room.roomLabel ? ` - Room ${room.roomLabel}` : ""
        }`,
    ),
    agency.whatsapp
      ? `AGENCY: ${agency.name} (${agency.whatsapp})`
      : `AGENCY: ${agency.name}`,
  ]
    .filter((line): line is string => !!line)
    .join("\n");
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground truncate">{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <input
          type="color"
          aria-label={`${label} colour`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-7 cursor-pointer rounded-md border border-border/60 bg-transparent p-0.5"
        />
        <input
          type="text"
          aria-label={`${label} hex`}
          value={value.toUpperCase()}
          onChange={(e) => {
            const next = e.target.value.trim();
            // Only commit a value the swatch can render, so a half-typed hex
            // doesn't blank the card mid-keystroke.
            if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next.toLowerCase());
          }}
          className="h-7 w-[76px] rounded-md border border-border/60 bg-transparent px-2 tabular-nums text-[11px] uppercase"
        />
      </div>
    </div>
  );
}

/**
 * The in-app ID card studio: pick a design, restyle every element on it, fix
 * the printed name, drop in a photo, print.
 *
 * Printing happens from inside the app shell rather than a separate tab, so
 * the two card faces are also rendered into a portal at the end of `body`;
 * the print stylesheet hides every other direct child of `body`, which is
 * what stops the sidebar and header from ending up on the card (the reason
 * the guide run sheet avoided `window.print()` altogether). Nothing typed
 * here is written back to the pilgrim record — this is a print job.
 */
export default function IdCardStudio({ data }: { data: IdCardStudioData }) {
  const design = useSyncExternalStore(
    subscribeDesign,
    readDesign,
    serverDesign,
  );
  const mounted = useSyncExternalStore(
    subscribeClient,
    () => true,
    () => false,
  );
  const [printedName, setPrintedName] = useState(data.pilgrim.fullName);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.8);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { templateId, palettes } = design;
  const template = templateById(templateId);
  const palette: CardPalette = useMemo(
    () => ({ ...template.defaults, ...(palettes[template.id] ?? {}) }),
    [template, palettes],
  );

  const setTemplateId = (nextId: string) =>
    writeDesign({ ...design, templateId: nextId });

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(buildQrText(data, printedName || data.pilgrim.fullName), {
      margin: 1,
      width: 320,
      color: { dark: "#111827ff", light: "#ffffffff" },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [data, printedName]);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const patchPalette = (patch: Partial<CardPalette>) =>
    writeDesign({
      ...design,
      palettes: {
        ...palettes,
        [templateId]: { ...(palettes[templateId] ?? {}), ...patch },
      },
    });

  const setToken = (key: keyof CardPalette, value: string) =>
    patchPalette({ [key]: value } as Partial<CardPalette>);

  const resetColours = () => {
    const nextPalettes = { ...palettes };
    delete nextPalettes[templateId];
    writeDesign({ ...design, palettes: nextPalettes });
  };

  const applyBrandColours = () => {
    const primary = data.agency.primaryColor;
    const secondary = data.agency.secondaryColor || data.agency.primaryColor;
    patchPalette({
      bandPrimary: primary,
      bandSecondary: secondary,
      accent: primary,
      photoRing: template.id === "voyage" ? "#ffffff" : secondary,
      footerBg: primary,
    });
  };

  const cardData: CardData = useMemo(
    () => ({
      photoUrl,
      name: printedName || data.pilgrim.fullName,
      passportNumber: data.pilgrim.passportNumber,
      bookingReference: data.pilgrim.bookingReference,
      groupCode: data.group.groupCode,
      packageName: data.group.packageName,
      departureDateLabel: formatDate(data.group.departureDate),
      journeyLabel: JOURNEY_LABELS[data.group.journeyType],
      agencyName: data.agency.name,
      agencyLogoUrl: data.agency.logoUrl,
      qrDataUrl,
      emergencyContactLabel: data.pilgrim.emergencyContactName
        ? `${data.pilgrim.emergencyContactName}${
            data.pilgrim.emergencyContactPhone
              ? ` · ${data.pilgrim.emergencyContactPhone}`
              : ""
          }`
        : null,
      rooms: data.pilgrim.rooms.map((room) => ({
        ...room,
        city: CITY_LABELS[room.city] ?? room.city,
      })),
      agencyContactLabel: data.agency.whatsapp ?? data.agency.officeAddress,
    }),
    [photoUrl, printedName, data, qrDataUrl],
  );

  // The chosen template's own components, not new ones defined here — a
  // component declared during render would remount (and lose the QR image's
  // decode) on every colour keystroke.
  const FrontFace = template.Front;
  const BackFace = template.Back;

  const previewBox = (label: string, face: React.ReactNode) => (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div
        style={{
          width: `calc(54mm * ${zoom})`,
          height: `calc(85.6mm * ${zoom})`,
        }}
        className="shrink-0"
      >
        <div
          className="overflow-hidden rounded-[3mm] shadow-[0_10px_30px_rgba(15,23,42,0.18)]"
          style={{
            width: "54mm",
            height: "85.6mm",
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
          }}
        >
          {face}
        </div>
      </div>
    </div>
  );

  const frontFields = PALETTE_FIELDS.filter((f) => f.face === "front");
  const backFields = PALETTE_FIELDS.filter((f) => f.face === "back");

  return (
    <div className="flex flex-col gap-8 pb-10">
      <style>{`
        .rafc-print-root { display: none; }
        @media print {
          @page { size: 54mm 85.6mm; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; }
          body > *:not(.rafc-print-root) { display: none !important; }
          .rafc-print-root { display: block !important; }
          .rafc-print-face {
            width: 54mm; height: 85.6mm; overflow: hidden;
            break-after: page; page-break-after: always;
          }
          .rafc-print-face:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>

      <PageHeader
        title="ID Card Studio"
        subTitle={`${data.pilgrim.fullName} · ${data.group.groupCode} · ${data.group.packageName}`}
        breadcrumb={[
          { title: "Departure Groups", link: "/departure-groups" },
          {
            title: data.group.groupName,
            link: `/departure-groups/${data.groupId}`,
          },
          { title: "ID Card Studio", link: "#" },
        ]}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              render={
                <Link href={`/departure-groups/${data.groupId}?tab=pilgrims`} />
              }
            >
              <ArrowLeft /> Back to group
            </Button>
            <Button onClick={() => window.print()}>
              <Printer /> Print ID Card
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Canvas */}
        <Card className="gap-4">
          <div className="flex items-center justify-between gap-3">
            <div
              role="group"
              aria-label="ID card design"
              className="flex flex-wrap items-center gap-2"
            >
              {CARD_TEMPLATES.map((t) => {
                const active = t.id === templateId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    aria-pressed={active}
                    className={`flex items-center gap-2 rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <span
                      className="size-4 rounded-full"
                      style={{
                        background: `linear-gradient(135deg, ${
                          palettes[t.id]?.bandPrimary ?? t.defaults.bandPrimary
                        }, ${palettes[t.id]?.bandSecondary ?? t.defaults.bandSecondary})`,
                      }}
                    />
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div
              role="group"
              aria-label="Preview zoom"
              className="flex items-center gap-1"
            >
              <Button
                variant="ghost"
                size="icon"
                aria-label="Zoom out"
                disabled={zoom <= 1.1}
                onClick={() =>
                  setZoom((z) => Math.max(1.1, Number((z - 0.2).toFixed(2))))
                }
              >
                <Minus />
              </Button>
              <span className="w-10 text-center tabular-nums text-xs text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Zoom in"
                disabled={zoom >= 3}
                onClick={() =>
                  setZoom((z) => Math.min(3, Number((z + 0.2).toFixed(2))))
                }
              >
                <Plus />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-8 rounded-lg bg-muted/40 p-6">
            {previewBox("Front", <FrontFace data={cardData} p={palette} />)}
            {previewBox("Back", <BackFace data={cardData} p={palette} />)}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Cards print at true CR-80 size (54 × 85.6 mm), one face per page.
            The app&apos;s own screen is hidden from the printout — pick a card
            tray, or &quot;Save as PDF&quot; for a digital copy.
          </p>
        </Card>

        {/* Inspector */}
        <div className="flex flex-col gap-4">
          <Card className="gap-3">
            <SectionHeading title="Content" />
            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>Printed name</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  value={printedName}
                  onChange={(e) => setPrintedName(e.target.value)}
                  placeholder={data.pilgrim.fullName}
                />
              </InputGroup>
              <p className="text-[11px] text-muted-foreground">
                Only affects this printout — the manifest keeps{" "}
                {data.pilgrim.fullName}.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (photoUrl) URL.revokeObjectURL(photoUrl);
                setPhotoUrl(URL.createObjectURL(file));
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="outline_without_border"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload /> {photoUrl ? "Replace photo" : "Add photo"}
              </Button>
              {photoUrl ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    URL.revokeObjectURL(photoUrl);
                    setPhotoUrl(null);
                  }}
                >
                  Remove
                </Button>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <UserRound className="size-3" /> Initials used without one
                </span>
              )}
            </div>
          </Card>

          <Card className="gap-3">
            <SectionHeading
              title="Colours"
              act={
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="xs" onClick={applyBrandColours}>
                    <Sparkles /> Brand
                  </Button>
                  <Button variant="ghost" size="xs" onClick={resetColours}>
                    <RotateCcw /> Reset
                  </Button>
                </div>
              }
            />

            <div className="flex items-center gap-2">
              <Palette className="size-3.5 text-muted-foreground" />
              <Badge
                variant="outline"
                className="text-[10px] text-muted-foreground"
              >
                {template.label} design
              </Badge>
            </div>

            <div className="flex flex-col">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Front
              </p>
              {frontFields.map((field) => (
                <ColorRow
                  key={field.key}
                  label={field.label}
                  value={palette[field.key]}
                  onChange={(next) => setToken(field.key, next)}
                />
              ))}
            </div>

            <Separator />

            <div className="flex flex-col">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Back
              </p>
              {backFields.map((field) => (
                <ColorRow
                  key={field.key}
                  label={field.label}
                  value={palette[field.key]}
                  onChange={(next) => setToken(field.key, next)}
                />
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Printed output — portalled to the end of <body> so the print
          stylesheet can hide the app shell by hiding body's other children. */}
      {mounted &&
        createPortal(
          <div className="rafc-print-root">
            <div className="rafc-print-face">
              <FrontFace data={cardData} p={palette} />
            </div>
            <div className="rafc-print-face">
              <BackFace data={cardData} p={palette} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
