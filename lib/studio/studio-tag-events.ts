const TAGS_CHANGED_EVENT = "rexadb:studio-tags-changed";
const TAGS_CHANNEL = "rexadb:studio-tags";
let publisherChannel: BroadcastChannel | null = null;

type TagChangeMessage = { connectionId: number };

function isMatchingMessage(value: unknown, connectionId: number): value is TagChangeMessage {
  return typeof value === "object" && value !== null &&
    "connectionId" in value && value.connectionId === connectionId;
}

/** Notify this window and any other RexaDB window showing the same connection. */
export function publishStudioTagsChanged(connectionId: number) {
  if (typeof window === "undefined") return;
  const message = { connectionId };
  window.dispatchEvent(new CustomEvent(TAGS_CHANGED_EVENT, { detail: message }));
  if (typeof BroadcastChannel !== "undefined") {
    publisherChannel ??= new BroadcastChannel(TAGS_CHANNEL);
    publisherChannel.postMessage(message);
  }
}

export function subscribeStudioTagsChanged(
  connectionId: number,
  onChange: () => void,
) {
  if (typeof window === "undefined") return () => {};
  const onWindowChange = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (isMatchingMessage(detail, connectionId)) onChange();
  };
  window.addEventListener(TAGS_CHANGED_EVENT, onWindowChange);

  let channel: BroadcastChannel | undefined;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(TAGS_CHANNEL);
    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (isMatchingMessage(event.data, connectionId)) onChange();
    });
  }
  return () => {
    window.removeEventListener(TAGS_CHANGED_EVENT, onWindowChange);
    channel?.close();
  };
}
