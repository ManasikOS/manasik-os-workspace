"use client";

import React, { useState } from "react";
import {
  Plus,
  Trash2,
  MoveUp,
  MoveDown,
  Calendar,
  Sparkles,
  ChevronDown,
  MapPin,
} from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { PackageFormData, ItineraryItem } from "../types";
import type { PackageFieldErrors } from "../schemas";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";

interface StepJourneyTemplateProps {
  formData: PackageFormData;
  setFormData: React.Dispatch<React.SetStateAction<PackageFormData>>;
  /** Messages for this step's fields; only passed once the step has been visited and left. */
  fieldErrors?: PackageFieldErrors | null;
}

/* eslint-disable no-restricted-syntax -- fixed 10-way itinerary-category
   legend (Flight/Arrival/Hotel/…), a categorical tag colour rather than a
   status/severity signal, so it keeps its own distinct hues instead of
   routing through the tone system. */
const CATEGORY_COLORS: Record<string, string> = {
  Flight: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  Arrival: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  Hotel: "bg-cyan-500/10 text-cyan-600 border-cyan-500/30",
  Transfer: "bg-teal-500/10 text-teal-600 border-teal-500/30",
  Ritual: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  Ziyarah: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  Ziyarat: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  Meal: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  "Free Time": "bg-purple-500/10 text-purple-600 border-purple-500/30",
  Departure: "bg-rose-500/10 text-rose-600 border-rose-500/30",
  Other: "bg-slate-500/10 text-slate-600 border-slate-500/30",
};
/* eslint-enable no-restricted-syntax */

const CATEGORY_OPTIONS: NonNullable<ItineraryItem["category"]>[] = [
  "Flight",
  "Arrival",
  "Hotel",
  "Transfer",
  "Ritual",
  "Ziyarah",
  "Meal",
  "Free Time",
  "Departure",
  "Other",
];

export const StepJourneyTemplate: React.FC<StepJourneyTemplateProps> = ({
  formData,
  setFormData,
  fieldErrors = null,
}) => {
  const [expandedDayId, setExpandedDayId] = useState<string | null>(
    formData.itinerary[0]?.id || null,
  );

  const updateField = <K extends keyof PackageFormData>(
    field: K,
    value: PackageFormData[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Itinerary Actions
  const addItineraryDay = () => {
    const nextNum = formData.itinerary.length + 1;
    const newDay: ItineraryItem = {
      id: `it-${crypto.randomUUID()}`,
      dayNumber: nextNum,
      title: `Day ${nextNum}: Guided Activities`,
      location: nextNum <= 6 ? "Makkah Al-Mukarramah" : "Madinah Al-Munawwarah",
      category: "Ziyarah",
      description:
        "Scheduled prayers at Haram, guided religious instructions, and group assembly.",
      internalNotes: "",
    };
    updateField("itinerary", [...formData.itinerary, newDay]);
    setExpandedDayId(newDay.id);
  };

  const removeItineraryDay = (index: number) => {
    const updated = formData.itinerary
      .filter((_, i) => i !== index)
      .map((item, idx) => ({ ...item, dayNumber: idx + 1 }));
    updateField("itinerary", updated);
  };

  const updateItineraryItem = (
    index: number,
    updated: Partial<ItineraryItem>,
  ) => {
    const copy = [...formData.itinerary];
    copy[index] = { ...copy[index], ...updated };
    updateField("itinerary", copy);
  };

  const moveItineraryDay = (index: number, dir: "up" | "down") => {
    const targetIdx = dir === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= formData.itinerary.length) return;
    const copy = [...formData.itinerary];
    const temp = copy[index];
    copy[index] = copy[targetIdx];
    copy[targetIdx] = temp;
    const reindexed = copy.map((item, idx) => ({
      ...item,
      dayNumber: idx + 1,
    }));
    updateField("itinerary", reindexed);
  };

  // Pre-configured Itinerary Templates Generators
  const generateStandardUmrah = () => {
    const items: ItineraryItem[] = [
      {
        id: "s-1",
        dayNumber: 1,
        title: "Departure & Arrival in Makkah",
        location: "Colombo / Jeddah / Makkah",
        category: "Arrival",
        description:
          "Flight from Colombo to Jeddah. VIP Bus transfer to Makkah hotel, check-in, and orientation.",
      },
      {
        id: "s-2",
        dayNumber: 2,
        title: "Perform Umrah Rituals",
        location: "Masjid al-Haram",
        category: "Ritual",
        description: "Guided Tawaaf and Sa'i accompanied by Mutawwif guide.",
      },
      {
        id: "s-3",
        dayNumber: 3,
        title: "Makkah Ziyarah Tour",
        location: "Makkah Historical Sites",
        category: "Ziyarah",
        description:
          "Visits to Jabal Al-Noor (Cave Hira), Jabal Thawr, Mina, Arafat, and Muzdalifah.",
      },
      {
        id: "s-4",
        dayNumber: 4,
        title: "Free Worship in Makkah",
        location: "Masjid al-Haram",
        category: "Free Time",
        description: "Personal prayers, Nafl Tawaaf, and spiritual reflection.",
      },
      {
        id: "s-5",
        dayNumber: 5,
        title: "Intercity Transfer to Madinah",
        location: "Makkah ↔ Madinah",
        category: "Transfer",
        description:
          "Hotel check-out and AC VIP bus transfer to Madinah Al-Munawwarah.",
      },
      {
        id: "s-6",
        dayNumber: 6,
        title: "Greetings at Rawdah Sharif",
        location: "Masjid an-Nabawi",
        category: "Ritual",
        description:
          "Guided greetings at Salam Gate and Rawdah Sharif prayer permit visit.",
      },
      {
        id: "s-7",
        dayNumber: 7,
        title: "Madinah Ziyarah Tour",
        location: "Madinah Historical Sites",
        category: "Ziyarah",
        description:
          "Visits to Quba Mosque, Mount Uhud, Qiblatain Mosque, and Date Market.",
      },
      {
        id: "s-8",
        dayNumber: 8,
        title: "Final Departure & Return",
        location: "Madinah / Jeddah / Colombo",
        category: "Departure",
        description:
          "Hotel check-out, transfer to airport, and flight back to Colombo.",
      },
    ];
    updateField("itinerary", items);
    updateField("days", 8);
    updateField("nights", 7);
    updateField("duration", "8 Days / 7 Nights");
    setExpandedDayId(items[0]?.id || null);
  };

  const generateRamadanUmrah = () => {
    const items: ItineraryItem[] = [
      {
        id: "r-1",
        dayNumber: 1,
        title: "Arrival in Makkah for Ramadan",
        location: "Jeddah / Makkah",
        category: "Arrival",
        description:
          "Arrival in Jeddah and VIP coach transfer to Makkah hotel.",
      },
      {
        id: "r-2",
        dayNumber: 2,
        title: "Ramadan Umrah Rituals",
        location: "Masjid al-Haram",
        category: "Ritual",
        description: "Tawaaf, Sa'i, and Taraweeh prayers in Haram.",
      },
      {
        id: "r-3",
        dayNumber: 3,
        title: "Iftar & Qiyam Layl in Haram",
        location: "Masjid al-Haram",
        category: "Ritual",
        description: "Communal Iftar and late night Qiyam prayers.",
      },
      {
        id: "r-4",
        dayNumber: 4,
        title: "Makkah Ziyarah",
        location: "Makkah",
        category: "Ziyarah",
        description: "Guided morning visit to Jabal Al-Noor and Arafat.",
      },
      {
        id: "r-5",
        dayNumber: 5,
        title: "Transfer to Madinah",
        location: "Makkah ↔ Madinah",
        category: "Transfer",
        description: "Transfer to Madinah Al-Munawwarah.",
      },
      {
        id: "r-6",
        dayNumber: 6,
        title: "Rawdah Sharif Visit",
        location: "Masjid an-Nabawi",
        category: "Ritual",
        description: "Scheduled Rawdah visit and Iftar in Prophet's Mosque.",
      },
      {
        id: "r-7",
        dayNumber: 7,
        title: "Madinah Historical Sites",
        location: "Madinah",
        category: "Ziyarah",
        description: "Visit Quba and Uhud martyrs cemetery.",
      },
      {
        id: "r-8",
        dayNumber: 8,
        title: "Return Flight to Colombo",
        location: "Madinah / Colombo",
        category: "Departure",
        description: "Check-out and departure flight.",
      },
    ];
    updateField("itinerary", items);
    updateField("days", 8);
    updateField("nights", 7);
    updateField("duration", "8 Days / 7 Nights");
    setExpandedDayId(items[0]?.id || null);
  };

  const generateStandardHajj = () => {
    const items: ItineraryItem[] = [
      {
        id: "h-1",
        dayNumber: 1,
        title: "Arrival in Saudi Arabia for Hajj",
        location: "Jeddah / Makkah",
        category: "Arrival",
        description:
          "Hajj flight arrival, entry procedures, transfer to Makkah hotel.",
      },
      {
        id: "h-2",
        dayNumber: 2,
        title: "Umrah Al-Tamattu Rituals",
        location: "Masjid al-Haram",
        category: "Ritual",
        description: "Perform Tawaaf and Sa'i for Umrah of Hajj Tamattu.",
      },
      {
        id: "h-3",
        dayNumber: 3,
        title: "8th Dhul Hijjah: Move to Mina",
        location: "Mina Tents",
        category: "Transfer",
        description: "Transfer to Mina tent camp for Day of Tarwiyah.",
      },
      {
        id: "h-4",
        dayNumber: 4,
        title: "9th Dhul Hijjah: Day of Arafat & Muzdalifah",
        location: "Arafat / Muzdalifah",
        category: "Ritual",
        description: "Wuqoof in Arafat until sunset, night stay in Muzdalifah.",
      },
      {
        id: "h-5",
        dayNumber: 5,
        title: "10th Dhul Hijjah: Jamarat & Tawaaf Ziyarah",
        location: "Jamarat / Haram",
        category: "Ritual",
        description:
          "Stoning Big Jamarah, Qurbani, Tahallul, and Tawaaf Al-Ifadah.",
      },
      {
        id: "h-6",
        dayNumber: 6,
        title: "11th-12th Dhul Hijjah: Days of Tashreeq",
        location: "Mina / Jamarat",
        category: "Ritual",
        description: "Ramy of all 3 Jamarat and return to Makkah.",
      },
      {
        id: "h-7",
        dayNumber: 7,
        title: "Transfer to Madinah",
        location: "Madinah Hotel",
        category: "Transfer",
        description: "Post-Hajj transfer to Madinah Al-Munawwarah.",
      },
      {
        id: "h-8",
        dayNumber: 8,
        title: "Return Journey Home",
        location: "Madinah / Colombo",
        category: "Departure",
        description: "Final check-out and departure flight.",
      },
    ];
    updateField("itinerary", items);
    updateField("days", 8);
    updateField("nights", 7);
    updateField("duration", "8 Days / 7 Nights");
    setExpandedDayId(items[0]?.id || null);
  };

  const itineraryListError =
    fieldErrors?.itinerary?.[0] ?? fieldErrors?.duration?.[0];

  return (
    <div className="flex flex-col gap-5">
      {/* GROUP: day-by-day itinerary */}
      <Card className="px-5 py-5" variant="md-shadow">
        <CardHeader>
          <CardTitle>Day-by-day itinerary</CardTitle>
          <CardDescription>
            {formData.itinerary.length} of {formData.days} days configured.
            Exact operational dates are confirmed later in Departure Groups.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {formData.journeyType === "Hajj" ? (
              <Button
                type="button"
                variant="outline_without_border"
                onClick={generateStandardHajj}
              >
                <Sparkles className="size-3 text-primary" />
                Generate Hajj Itinerary
              </Button>
            ) : formData.journeyType === "Early Registration" ? (
              <Button
                type="button"
                variant="outline_without_border"
                onClick={generateStandardUmrah}
              >
                Add Indicative Itinerary
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline_without_border"
                  onClick={generateStandardUmrah}
                >
                  <Sparkles className="size-3 text-primary" />
                  Standard Umrah
                </Button>
                <Button
                  type="button"
                  variant="outline_without_border"
                  onClick={generateRamadanUmrah}
                >
                  <Sparkles className="size-3 text-primary" />
                  Ramadan Umrah
                </Button>
              </>
            )}

            <Button
              type="button"
              variant="default"
              className="sm:ml-auto"
              onClick={addItineraryDay}
            >
              <Plus className="size-3.5" /> Add Day
            </Button>
          </div>

          {itineraryListError ? (
            <p className="text-xs text-destructive">{itineraryListError}</p>
          ) : null}

          {formData.itinerary.length === 0 ? (
            <div
              role="status"
              className="flex flex-col items-center gap-2 rounded-md border border-dashed py-8 text-center"
            >
              <Calendar className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No itinerary days yet. Choose a generator above or add a day.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {formData.itinerary.map((item, idx) => {
                const isExpanded = expandedDayId === item.id;
                const colorClass =
                  CATEGORY_COLORS[item.category || "Other"] ||
                  CATEGORY_COLORS.Other;
                const dayCount = formData.itinerary.length;

                return (
                  <Card
                    key={item.id}
                    variant="md-shadow"
                    className={cn(
                      "gap-4 px-5 py-5",
                      !isExpanded && " hover:bg-card",
                    )}
                  >
                    {/* Collapsed header: the whole row toggles for mouse
                        users; the chevron button is the keyboard path. */}
                    <CardHeader
                      className="cursor-pointer"
                      onClick={() =>
                        setExpandedDayId(isExpanded ? null : item.id)
                      }
                    >
                      <CardTitle className="text-sm">{item.title}</CardTitle>
                      <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
                        <span>Day {item.dayNumber}</span>
                        {item.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3" /> {item.location}
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className={cn("border-none", colorClass)}
                        >
                          {item.category || "Ziyarah"}
                        </Badge>
                      </CardDescription>
                      <CardAction
                        className="flex items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="min-h-0 px-0"
                          aria-label={`Move day ${item.dayNumber} up`}
                          onClick={() => moveItineraryDay(idx, "up")}
                          disabled={idx === 0}
                        >
                          <MoveUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="min-h-0 px-0"
                          aria-label={`Move day ${item.dayNumber} down`}
                          onClick={() => moveItineraryDay(idx, "down")}
                          disabled={idx === dayCount - 1}
                        >
                          <MoveDown />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="min-h-0 px-0 hover:text-destructive"
                          aria-label={`Delete day ${item.dayNumber}`}
                          onClick={() => removeItineraryDay(idx)}
                        >
                          <Trash2 />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="min-h-0 px-0"
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded
                              ? `Collapse day ${item.dayNumber}`
                              : `Edit day ${item.dayNumber}`
                          }
                          onClick={() =>
                            setExpandedDayId(isExpanded ? null : item.id)
                          }
                        >
                          <ChevronDown
                            className={cn(
                              "transition-transform",
                              isExpanded && "rotate-180",
                            )}
                          />
                        </Button>
                      </CardAction>
                    </CardHeader>

                    {isExpanded && (
                      <CardContent className="flex flex-col gap-4">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="md:col-span-2">
                            <InputGroup>
                              <InputGroupAddon align="block-start">
                                <InputGroupText>
                                  Title{" "}
                                  <span className="text-destructive">*</span>
                                </InputGroupText>
                              </InputGroupAddon>
                              <InputGroupInput
                                value={item.title}
                                onChange={(e) =>
                                  updateItineraryItem(idx, {
                                    title: e.target.value,
                                  })
                                }
                              />
                            </InputGroup>
                          </div>

                          <InputGroup>
                            <InputGroupAddon align="block-start">
                              <InputGroupText>
                                Location{" "}
                                <span className="text-destructive">*</span>
                              </InputGroupText>
                            </InputGroupAddon>
                            <InputGroupInput
                              value={item.location || ""}
                              onChange={(e) =>
                                updateItineraryItem(idx, {
                                  location: e.target.value,
                                })
                              }
                              placeholder="e.g. Makkah"
                              className="text-xs"
                            />
                          </InputGroup>
                        </div>

                        {/* Category tag selection */}
                        <div
                          role="group"
                          aria-label={`Category for day ${item.dayNumber}`}
                          className="flex flex-col mt-2 gap-2"
                        >
                          <span className="text-xs font-medium text-muted-foreground">
                            Category Tag{" "}
                            <span className="text-destructive">*</span>
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {CATEGORY_OPTIONS.map((tag) => (
                              <Button
                                key={tag}
                                type="button"
                                size="sm"
                                className="min-h-0"
                                variant={
                                  item.category === tag
                                    ? "default"
                                    : "outline_without_border"
                                }
                                aria-pressed={item.category === tag}
                                onClick={() =>
                                  updateItineraryItem(idx, { category: tag })
                                }
                              >
                                {tag}
                              </Button>
                            ))}
                          </div>
                        </div>

                        {/* Descriptions */}
                        <div className="grid grid-cols-1 mt-4 gap-3 md:grid-cols-2">
                          <InputGroup className="h-auto">
                            <InputGroupAddon align="block-start">
                              <InputGroupText>
                                Pilgrim-facing Description{" "}
                                <span className="text-destructive">*</span>
                              </InputGroupText>
                            </InputGroupAddon>
                            <InputGroupTextarea
                              rows={3}
                              placeholder="Detailed activities, assembly points, guided tours..."
                              value={item.description}
                              onChange={(e) =>
                                updateItineraryItem(idx, {
                                  description: e.target.value,
                                })
                              }
                              className="text-xs"
                            />
                          </InputGroup>

                          <InputGroup className={cn("h-auto")}>
                            <InputGroupAddon align="block-start">
                              <InputGroupText
                                className={cn("font-medium", TONE_TEXT.warning)}
                              >
                                Internal Operations Note (Hidden from Pilgrims)
                              </InputGroupText>
                            </InputGroupAddon>
                            <InputGroupTextarea
                              rows={3}
                              placeholder="Bus pickup timings, guide assignments, luggage handling instructions..."
                              value={item.internalNotes || ""}
                              onChange={(e) =>
                                updateItineraryItem(idx, {
                                  internalNotes: e.target.value,
                                })
                              }
                              className="text-xs"
                            />
                          </InputGroup>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StepJourneyTemplate;
