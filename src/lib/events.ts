import "server-only";

/** Domain events. Handlers live in their own modules and must never throw. */
export type AppEvent =
  | { name: "contact.created"; contactId: string }
  | { name: "message.received"; contactId: string; messageId: string; text: string; type: string }
  | { name: "message.status"; contactId: string | null; wamid: string; status: string; error: string }
  | { name: "contact.list_added"; contactId: string; listId: string }
  | { name: "chat.assigned"; contactId: string; userId: string | null; byUserId: string | null }
  | { name: "campaign.completed"; campaignId: string };

export type EventName = AppEvent["name"];
export const EVENT_NAMES: EventName[] = [
  "contact.created",
  "message.received",
  "message.status",
  "contact.list_added",
  "chat.assigned",
  "campaign.completed",
];

/** Fire-and-forget fan-out to automations, notifications and outgoing webhooks. */
export async function emit(event: AppEvent): Promise<void> {
  const handlers = await Promise.all([
    import("./automations").then((m) => m.handleEvent),
    import("./notifications").then((m) => m.handleEvent),
    import("./outgoing-webhooks").then((m) => m.handleEvent),
    import("./drips").then((m) => m.handleEvent),
    import("./sheets-sync").then((m) => m.handleEvent),
  ]);
  await Promise.all(
    handlers.map((h) =>
      h(event).catch((e: unknown) => console.error(`[events] ${event.name} handler failed`, e)),
    ),
  );
}
