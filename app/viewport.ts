import type { Viewport } from "next";

/** Phone-safe canvas. Exported so layout and verify-mobile-layout share one source. */
export const appViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};
