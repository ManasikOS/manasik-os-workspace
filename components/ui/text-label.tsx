"use client";
import React from "react";
import ShinyText from "./shiny-text";

const TextLabel = ({ label }: { label: string }) => {
  return (
    <div>
      {" "}
      <ShinyText
        text={label}
        speed={4}
        delay={0}
        color="#b5b5b5"
        shineColor="#ffffff"
        spread={120}
        className="uppercase font-medium tracking-[0.1rem]"
        direction="left"
        yoyo={false}
        pauseOnHover={false}
        disabled={false}
      />
    </div>
  );
};

export default TextLabel;
