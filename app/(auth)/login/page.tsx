import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import React from "react";
import LoginForm from "./components/login-form";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import Logo from "@/public/logos/manasik-os-logo-light.png";
import Image from "next/image";
type LoginPageProps = {
  searchParams: Promise<{ mode?: string; error?: string; next?: string }>;
};

const LoginPage = async ({ searchParams }: LoginPageProps) => {
  const { mode, error, next } = await searchParams;

  return (
    <div className="flex relative gap-10 overflow-hidden h-screen justify-center">
      <div className="absolute right-5 top-4">
        <ThemeSwitch />
      </div>
      <div className="flex-5 hidden relative px-5 xl:flex flex-col items-start justify-start">
        <div className="relative items-start text-start h-full flex flex-col py-5">
          <div>
            <Image src={Logo} alt="Logo" width={300} height={300} />

            {/* <p className="text-lg">Hajj & Umrah Operations</p> */}
          </div>
          <h1 className="font-playfair text-8xl tracking-tighter mt-5">
            Manage every pilgrim journey, in one secure place.
          </h1>
          <h3 className="mt-7 tracking-tighter text-muted-foreground text-3xl">
            From inquiry to return, keep your agency, pilgrims, documents, and
            payments connected.
          </h3>

          {/* <div className="mt-3 justify-end flex flex-col">
            <p>🔒 Your agency and pilgrim records are protected.</p>
            <p>Privacy · Terms · Support</p>
          </div> */}
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--tw-gradient-stops))] from-primary/30 via-zinc-950 to-zinc-950"></div>

        <div className="absolute top-0 right-0 w-150 h-150 bg-primary/10 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/3"></div>
        <div className="absolute bottom-0 left-0 w-125 h-125 bg-primary/10 rounded-full blur-[100px] translate-y-1/3 -translate-x-1/3"></div>

        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-size-[40px_40px] mask-[radial-gradient(ellipse_80%_80%_at_50%_50%,#000_10%,transparent_100%)] h-full w-full"></div>
      </div>

      <div className="flex-4 flex justify-center h-full items-center flex-col border-l bg-linear-to-br from-primary/10 via-primary/5 to-background overflow-y-auto">
        <Image
          src={Logo}
          alt="Logo"
          width={300}
          height={300}
          className="block xl:hidden mt-10 w-40 h-auto sm:w-52"
        />

        {/* Below xl the full hero column is hidden entirely — this is the
            compact stand-in so the brand headline isn't lost on tablet/
            mobile, just scaled down rather than removed (see
            docs/architecture/design-tokens.md's note on this page's one deliberate
            desktop-only flourish). */}
        <div className="flex xl:hidden flex-col items-center text-center gap-2 px-6 pt-4 pb-2 max-w-md">
          <h1 className="font-playfair text-2xl sm:text-3xl tracking-tight text-foreground">
            Manage every pilgrim journey, in one secure place.
          </h1>
          <p className="text-sm text-muted-foreground">
            From inquiry to return, keep your agency, pilgrims, documents, and
            payments connected.
          </p>
        </div>

        <LoginForm
          resetMode={mode === "reset"}
          setupMode={mode === "setup"}
          notice={error}
          redirectTo={next}
          signupOpen={process.env.SIGNUP_MODE === "open"}
        />
      </div>
    </div>
  );
};

export default LoginPage;
