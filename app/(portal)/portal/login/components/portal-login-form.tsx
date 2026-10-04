"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { requestPortalMagicLinkAction } from "../actions";

export default function PortalLoginForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    await requestPortalMagicLinkAction(email);
    setSubmitting(false);
    setSent(true);
  };

  return (
    <Card className="p-6 flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium text-foreground">Pilgrim Portal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sign in with the email address your travel agency has on file for you.
        </p>
      </div>

      {sent ? (
        <p className="text-sm text-foreground">
          If that email is set up for portal access, we&apos;ve sent a sign-in link to it. Check your inbox
          (and spam folder) and click the link to continue.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Email address</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              onKeyDown={(e) => e.key === "Enter" && email.trim() && submit()}
            />
          </div>
          <Button onClick={submit} disabled={submitting || !email.trim()}>
            {submitting ? "Sending…" : "Send sign-in link"}
          </Button>
        </>
      )}
    </Card>
  );
}
