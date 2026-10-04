"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import type { StaffRole } from "@/lib/access/departure-groups-access";

import type {
  DepartureGroupAccommodation,
  DepartureGroupBooking,
  DepartureGroupFlight,
  DepartureGroupManifestRow,
  DepartureGroupPackageSnapshot,
  DepartureGroupPricing,
  DepartureGroupTransport,
  DeviationType,
  ServiceAddon,
} from "../../../../types";
import {
  DEVIATION_BY_TYPE,
  DEVIATION_FAMILY_META,
  type DeviationFamily,
  entriesForFamily,
} from "../deviation-registry";
import AddChargeDialog from "../../add-charge-dialog";
import ChangeRoomPreferenceDialog from "../../change-room-preference-dialog";
import AssistanceDialog from "./assistance-dialog";
import CabinUpgradeDialog from "./cabin-upgrade-dialog";
import DocumentRequirementDialog from "./document-requirement-dialog";
import ExtendedStayDialog from "./extended-stay-dialog";
import ExtraNightsDialog from "./extra-nights-dialog";
import HotelUpgradeDialog from "./hotel-upgrade-dialog";
import ItineraryAdditionDialog from "./itinerary-addition-dialog";
import ItineraryOptOutDialog from "./itinerary-opt-out-dialog";
import LandOnlyDialog from "./land-only-dialog";
import MealPlanDialog from "./meal-plan-dialog";
import OtherDeviationDialog from "./other-deviation-dialog";
import OwnFlightDialog from "./own-flight-dialog";
import PickupPointDialog from "./pickup-point-dialog";
import PrivateTransferDialog from "./private-transfer-dialog";
import RoommateRequestDialog from "./roommate-request-dialog";
import SeatPreferenceDialog from "./seat-preference-dialog";
import ServiceAddonDialog from "./service-addon-dialog";

type CustomiseTab = DeviationType | "ROOM_PREFERENCE" | "ADD_CHARGE";

interface TabEntry {
  key: CustomiseTab;
  label: string;
}

const FAMILY_ORDER: DeviationFamily[] = [
  "accommodation",
  "flight",
  "itinerary",
  "other",
];

function tabsForFamily(family: DeviationFamily): TabEntry[] {
  const deviationTabs: TabEntry[] = entriesForFamily(family).map((e) => ({
    key: e.type,
    label: e.label,
  }));

  if (family === "accommodation") {
    deviationTabs.push({ key: "ROOM_PREFERENCE", label: "Room preference" });
  }
  if (family === "other") {
    deviationTabs.push({ key: "ADD_CHARGE", label: "Add charge" });
  }

  return deviationTabs;
}

interface CustomiseTravellerDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
  flights: DepartureGroupFlight[];
  accommodations: DepartureGroupAccommodation[];
  transports: DepartureGroupTransport[];
  itinerary: DepartureGroupPackageSnapshot["itinerary"];
  groupTravellers: { id: string; name: string }[];
  addons: ServiceAddon[];
  bookings: DepartureGroupBooking[];
  manifest: DepartureGroupManifestRow[];
  pricing: DepartureGroupPricing;
  role: StaffRole;
}

const CustomiseTravellerDialog = ({
  row,
  departureGroupId,
  open,
  onClose,
  flights,
  accommodations,
  transports,
  itinerary,
  groupTravellers,
  addons,
  bookings,
  manifest,
  pricing,
  role,
}: CustomiseTravellerDialogProps) => {
  const [activeFamily, setActiveFamily] = useState<DeviationFamily>(
    FAMILY_ORDER[0],
  );
  const [selectedTab, setSelectedTab] = useState<CustomiseTab | null>(
    () => tabsForFamily(FAMILY_ORDER[0])[0]?.key ?? null,
  );

  // Reset to the first family/tab whenever the dialog opens for a traveller.
  // Adjusting during render (rather than in an effect) avoids the extra
  // committed frame that would flash the previous traveller's selection.
  const openKey = open ? (row?.id ?? "") : null;
  const [lastOpenKey, setLastOpenKey] = useState<string | null>(openKey);
  if (openKey !== lastOpenKey) {
    setLastOpenKey(openKey);
    if (openKey !== null) {
      setActiveFamily(FAMILY_ORDER[0]);
      setSelectedTab(tabsForFamily(FAMILY_ORDER[0])[0]?.key ?? null);
    }
  }

  const tabs = tabsForFamily(activeFamily);

  const booking = useMemo(
    () => bookings.find((b) => b.id === row?.bookingId) ?? null,
    [bookings, row?.bookingId],
  );

  const travellersForBooking = useMemo(
    () => (row ? manifest.filter((r) => r.bookingId === row.bookingId) : []),
    [manifest, row],
  );

  if (!row) return null;

  const switchFamily = (family: DeviationFamily) => {
    setActiveFamily(family);
    const familyTabs = tabsForFamily(family);
    setSelectedTab(familyTabs[0]?.key ?? null);
  };

  const common = {
    row,
    departureGroupId,
    open,
    onClose,
    embedded: true as const,
  };

  const activeFamilyMeta = DEVIATION_FAMILY_META[activeFamily];

  const renderTabContent = () => {
    switch (selectedTab) {
      case "EXTRA_NIGHTS":
        return (
          <ExtraNightsDialog {...common} accommodations={accommodations} />
        );
      case "HOTEL_UPGRADE":
        return (
          <HotelUpgradeDialog {...common} accommodations={accommodations} />
        );
      case "MEAL_PLAN":
        return <MealPlanDialog {...common} accommodations={accommodations} />;
      case "ROOMMATE_REQUEST":
        return (
          <RoommateRequestDialog
            {...common}
            groupTravellers={groupTravellers}
          />
        );
      case "OWN_FLIGHT":
        return <OwnFlightDialog {...common} flights={flights} />;
      case "LAND_ONLY":
        return <LandOnlyDialog {...common} flights={flights} />;
      case "CABIN_UPGRADE":
        return <CabinUpgradeDialog {...common} flights={flights} />;
      case "SEAT_PREFERENCE":
        return <SeatPreferenceDialog {...common} flights={flights} />;
      case "EXTENDED_STAY":
        return <ExtendedStayDialog {...common} flights={flights} />;
      case "ITINERARY_OPT_OUT":
        return <ItineraryOptOutDialog {...common} itinerary={itinerary} />;
      case "ITINERARY_ADDITION":
        return <ItineraryAdditionDialog {...common} />;
      case "SERVICE_ADDON":
        return <ServiceAddonDialog {...common} addons={addons} />;
      case "PRIVATE_TRANSFER":
        return <PrivateTransferDialog {...common} transports={transports} />;
      case "PICKUP_POINT":
        return <PickupPointDialog {...common} transports={transports} />;
      case "DOCUMENT_REQUIREMENT":
        return <DocumentRequirementDialog {...common} />;
      case "ASSISTANCE":
        return <AssistanceDialog {...common} />;
      case "OTHER":
        return <OtherDeviationDialog {...common} />;
      case "ROOM_PREFERENCE":
        return (
          <ChangeRoomPreferenceDialog
            booking={booking}
            travellers={travellersForBooking}
            pricing={pricing}
            role={role}
            open={open}
            onClose={onClose}
            embedded
          />
        );
      case "ADD_CHARGE":
        return (
          <AddChargeDialog
            row={row}
            departureGroupId={departureGroupId}
            open={open}
            onClose={onClose}
            addons={addons}
            embedded
          />
        );
      default:
        return null;
    }
  };

  const tabLabel =
    selectedTab === "ROOM_PREFERENCE"
      ? "Room preference"
      : selectedTab === "ADD_CHARGE"
        ? "Add charge"
        : selectedTab
          ? (DEVIATION_BY_TYPE[selectedTab]?.label ?? "")
          : "";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex! h-[90vh] max-h-[90vh] flex-col! gap-0 overflow-hidden! p-0! sm:h-[85vh] sm:max-w-5xl!">
        <DialogHeader className="shrink-0 px-4 pt-5 pb-4 sm:px-6 sm:pt-6 sm:pb-6">
          <DialogTitle className="pr-8">
            Customize Traveller
          </DialogTitle>
          <DialogDescription className="truncate">
            {row.fullName}
            {tabLabel ? ` · ${tabLabel}` : ""}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          {/* ── Left sidebar: family navigation ── */}
          <nav className="custom-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 p-2 md:w-48 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:border-r md:border-b-0 md:p-3">
            {FAMILY_ORDER.map((family) => {
              const meta = DEVIATION_FAMILY_META[family];
              const isActive = family === activeFamily;
              return (
                <button
                  key={family}
                  type="button"
                  onClick={() => switchFamily(family)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm whitespace-nowrap transition-colors md:w-full",
                    isActive
                      ? "bg-primary/10 dark:bg-primary/20 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-input/50",
                  )}
                >
                  <meta.Icon className="size-4 shrink-0" />
                  {meta.label}
                </button>
              );
            })}
          </nav>

          {/* ── Right content: tabs for types + embedded form ── */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Type tabs within the active family */}
            <div className="custom-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 px-2 sm:px-4">
              {tabs.map((tab) => {
                const isActive = selectedTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setSelectedTab(tab.key)}
                    className={cn(
                      "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
                      isActive
                        ? "border-primary text-foreground font-medium"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Form content area */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4">
              {selectedTab ? (
                renderTabContent()
              ) : (
                <div className="flex flex-col items-center justify-center flex-1 text-center gap-2 py-8">
                  <activeFamilyMeta.Icon className="size-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    Select a customisation type above to get started
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CustomiseTravellerDialog;
