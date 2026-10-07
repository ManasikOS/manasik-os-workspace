"use client";

import { Card } from "@/components/ui/card";
import InputFormHeader from "@/components/ui/input-form-header";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Languages, Mail, MapPin, MessageCircle, User } from "lucide-react";
import React from "react";

import type { LeadContactChannel } from "../../types";
import { CONTACT_CHANNEL_LABELS } from "../../utils";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface LeadContactInfoProps {
  fullName: string;
  onFullNameChange: (value: string) => void;
  mobile: string;
  onMobileChange: (value: string) => void;
  email: string;
  onEmailChange: (value: string) => void;
  city: string;
  onCityChange: (value: string) => void;
  preferredLanguage: string;
  onPreferredLanguageChange: (value: string) => void;
  preferredChannel: LeadContactChannel;
  onPreferredChannelChange: (value: LeadContactChannel) => void;
  errors: Record<string, string>;
}

const CONTACT_CHANNELS: LeadContactChannel[] = [
  "WHATSAPP",
  "CALL",
  "EMAIL",
  "SMS",
  "IN_PERSON",
];

const CITIES = [
  "Colombo",
  "Kandy",
  "Galle",
  "Dehiwala",
  "Kalutara",
  "Gampaha",
  "Negombo",
  "Beruwala",
  "Puttalam",
  "Mannar",
  "Batticaloa",
  "Trincomalee",
  "Jaffna",
  "Kurunegala",
  "Matale",
  "Other",
];

const LANGUAGES = ["English", "Sinhala", "Tamil", "Not specified"];

export default function LeadContactInfo({
  fullName,
  onFullNameChange,
  mobile,
  onMobileChange,
  email,
  onEmailChange,
  city,
  onCityChange,
  preferredLanguage,
  onPreferredLanguageChange,
  preferredChannel,
  onPreferredChannelChange,
  errors,
}: LeadContactInfoProps) {
  return (
    <div className="">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-1">
        <div className="flex flex-col gap-1">
          <InputGroup
          // className={
          //   errors.fullName
          //     ? "border-destructive ring-1 ring-destructive/30"
          //     : ""
          // }
          >
            <InputGroupAddon align={"block-start"}>
              <InputGroupText>Full Name</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id="lead-name"
              type="text"
              autoComplete="name"
              placeholder="e.g. Mohamed Afras"
              value={fullName}
              onChange={(event) => onFullNameChange(event.target.value)}
              // aria-invalid={Boolean(errors.fullName)}
              // aria-describedby={errors.fullName ? "lead-name-error" : undefined}
              className="text-sm"
            />
          </InputGroup>
        </div>

        <div className="flex flex-col gap-1">
          <InputGroup
          // className={
          //   errors.mobile
          //     ? "border-destructive ring-1 ring-destructive/30"
          //     : ""
          // }
          >
            <InputGroupAddon align="block-start">
              <InputGroupText>
                {" "}
                WhatsApp / Mobile Number{" "}
                <span className="text-destructive">*</span>
              </InputGroupText>
            </InputGroupAddon>
            <ButtonGroup>
              <InputGroupInput value={"+94"} readOnly className="flex-1" />
              <InputGroupInput
                id="lead-mobile"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="77 123 4567"
                value={mobile}
                onChange={(event) => onMobileChange(event.target.value)}
                // aria-invalid={Boolean(errors.mobile)}
                // aria-describedby={errors.mobile ? "lead-mobile-error" : undefined}
                className="text-sm tabular-nums flex-6"
              />
            </ButtonGroup>
          </InputGroup>
          {/* {errors.mobile && (
            <span
              id="lead-mobile-error"
              className="text-[11px] text-destructive font-medium"
            >
              {errors.mobile}
            </span>
          )} */}
        </div>

        <div className="flex flex-col gap-1">
          <InputGroup
          // className={
          //   errors.email
          //     ? "border-destructive ring-1 ring-destructive/30"
          //     : ""
          // }
          >
            <InputGroupAddon align="block-start">
              <InputGroupText> Email Address</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id="lead-email"
              type="email"
              autoComplete="email"
              placeholder="e.g. afras@gmail.com"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              // aria-invalid={Boolean(errors.email)}
              // aria-describedby={errors.email ? "lead-email-error" : undefined}
            />
          </InputGroup>
          {/* {errors.email && (
            <span
              id="lead-email-error"
              className="text-[11px] text-destructive font-medium"
            >
              {errors.email}
            </span>
          )} */}
        </div>

        <div className="flex flex-col gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup className="cursor-pointer">
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText> City / Branch</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  className="cursor-pointer"
                  value={city}
                  readOnly
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {CITIES.map((option) => {
                return (
                  <DropdownMenuItem
                    key={option}
                    onClick={() => onCityChange(option)}
                  >
                    {option}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-col gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText> Preferred Contact Channel</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  value={CONTACT_CHANNEL_LABELS[preferredChannel]}
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {CONTACT_CHANNELS.map((channel) => {
                return (
                  <DropdownMenuItem
                    key={channel}
                    onClick={() => onPreferredChannelChange(channel)}
                  >
                    {CONTACT_CHANNEL_LABELS[channel]}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-col gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>Preferred Language</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  value={preferredLanguage}
                  readOnly
                  className="cursor-pointer"
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {LANGUAGES.map((lang) => {
                return (
                  <DropdownMenuItem
                    onClick={() => onPreferredLanguageChange(lang)}
                    key={lang}
                  >
                    {lang}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
