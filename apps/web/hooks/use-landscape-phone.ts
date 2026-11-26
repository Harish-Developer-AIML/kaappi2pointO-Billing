"use client";

import { useSyncExternalStore } from "react";

// A phone (or small tablet) turned sideways: wide enough for two panes, but
// below the desktop layout (lg = 1024 px). The POS then shows the menu and
// the cart side by side, like on a computer.
const QUERY = "(orientation: landscape) and (min-width: 600px) and (max-width: 1023.98px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useLandscapePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
