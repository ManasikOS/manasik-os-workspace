"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { SidebarTrigger } from "./ui/sidebar";
import { ThemeSwitch } from "./ui/theme-switch";
import Logo from "@/public/logos/manasik-os-logo.svg";
import DarkModeLogo from "@/public/logos/manasik-os-logo-dark.svg";
import Image from "next/image";
import { HeaderInboxLauncher } from "./header-inbox-launcher";

/* ─── Main header ────────────────────────────────────────────── */
const HeaderBar = ({
  notificationBellSlot,
  canViewInbox = false,
}: {
  /** The bell, passed in so the layout can stream it behind its own Suspense boundary. */
  notificationBellSlot: React.ReactNode;
  canViewInbox?: boolean;
}) => {
  return (
    <header
      className={cn(
        "flex w-full items-center justify-between gap-3 border-b border-muted-foreground/10 bg-card/95 px-3 py-2 backdrop-blur-xl",
      )}
    >
      {/* Left — sidebar toggle + logo */}
      <div className="flex items-center gap-2 shrink-0">
        <SidebarTrigger className="size-8 rounded-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground md:hidden" />
        <Image
          src={Logo}
          alt="Manasik OS"
          className="dark:hidden"
          width={140}
          height={140}
        />
        <Image
          src={DarkModeLogo}
          alt="Manasik OS"
          className="hidden dark:block"
          width={140}
          height={140}
        />
      </div>

      {/* Right — actions */}
      <div className="flex items-center gap-1 shrink-0">
        {canViewInbox && <HeaderInboxLauncher />}
        <div className="w-px h-5 bg-border/60 mx-1" />
        {notificationBellSlot}
        <ThemeSwitch />
      </div>
    </header>
  );
};

export default HeaderBar;
