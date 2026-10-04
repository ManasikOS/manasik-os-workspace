import { createServer } from "node:http";
import { chromium } from "playwright";
import { expect, it } from "vitest";

import nextConfig from "../../next.config";

// Exercise native audio with the same response policy as the Inbox. A bare page
// without CSP would miss the failure even when the recording itself is valid.
it("allows signed Supabase audio to play while blocking unrelated media origins", async () => {
  const rules = await nextConfig.headers!();
  const policy = rules.find((rule) => rule.source.startsWith("/((?!"))!.headers
    .find((header) => header.key === "Content-Security-Policy")!.value;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": policy });
    response.end('<!doctype html><audio controls preload="metadata"></audio>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // One second of PCM silence: no private recording or external request needed.
    const wav = Buffer.alloc(44 + 16_000);
    wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8_000, 24); wav.writeUInt32LE(16_000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36); wav.writeUInt32LE(16_000, 40);
    await page.route("https://*.supabase.co/**", (route) => route.fulfill({ contentType: "audio/wav", body: wav }));
    await page.goto(`http://127.0.0.1:${address.port}`);
    const loaded = await page.evaluate(async () => {
      const audio = document.querySelector("audio")!;
      const result = new Promise<string>((resolve) => {
        audio.onloadedmetadata = () => resolve("loaded");
        audio.onerror = () => resolve(`media error ${audio.error?.code}`);
      });
      audio.src = "https://inbox-test.supabase.co/storage/v1/object/sign/inbox-attachments/test?token=test";
      return result;
    });
    expect(loaded).toBe("loaded");
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.play());
    await page.waitForFunction(() => document.querySelector("audio")!.currentTime > 0.05);
    expect(await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.duration)).toBe(1);

    const blocked = await page.evaluate(() => new Promise<string>((resolve) => {
      document.addEventListener("securitypolicyviolation", (event) => resolve(event.effectiveDirective), { once: true });
      document.querySelector("audio")!.src = "https://untrusted.example/recording.wav";
    }));
    expect(blocked).toBe("media-src");
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}, 20_000);
