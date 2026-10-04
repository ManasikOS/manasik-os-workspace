"use client";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import { Check, Copy } from "lucide-react";
import React, { useState } from "react";

const CopyButton = ({
  textToCopy,
  className,
}: {
  textToCopy: string;
  className?: string;
}) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    try {
      // 1. Write text directly to clipboard
      await navigator.clipboard.writeText(textToCopy);

      // 2. Trigger feedback state
      setIsCopied(true);

      // 3. Reset the button text after 2 seconds
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };
  return (
    <div>
      {isCopied ? (
        <Check className={cn("size-4", TONE_TEXT.success, className)} />
      ) : (
        <Copy onClick={handleCopy} className={cn("size-3", className)} />
      )}
    </div>
  );
};

export default CopyButton;
