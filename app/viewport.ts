import type { Viewport } from "next";

/** Phone-safe canvas. Exported so layout and verify-mobile-layout share one source. */
export const appViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0F172A" },
  ],
};
