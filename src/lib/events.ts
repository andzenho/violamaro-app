export const EVENT_TYPES = [
  "post_click",
  "bot_start",
  "subscribed",
  "test_open",
  "test_done",
  "offer_view",
  "lead",
  "dialog_in",
  "dialog_out",
  "unsub",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}
