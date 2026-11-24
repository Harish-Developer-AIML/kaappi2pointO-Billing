// "Start over" signal for the Point of Sale page. Tapping Point of Sale in the
// bottom bar or sidebar while already on /pos is a same-page link, so Next
// doesn't remount the page; this event tells it to go back to the table list.
export const POS_RESET_EVENT = "kaappi:pos-reset";

export function requestPosReset() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(POS_RESET_EVENT));
}

/** Call from a Point of Sale link's onClick: resets when the user is already there. */
export function onPosLinkClick(pathname: string | null | undefined) {
  if (pathname?.startsWith("/pos")) requestPosReset();
}

// "Quick bill": a dine-in order with no table (counter / coffee-shop sale).
// Only a POS screen value; the order itself is created without a table.
export const NO_TABLE = "none";
