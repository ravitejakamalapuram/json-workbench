// The only module of the extension pages and the content script that touches
// chrome.storage (TARGET.md section 3.2); the service worker writes the
// handoff slot itself.
// Everything persisted is listed in StoredValues; outside the extension (Vite
// dev, tests without the fake chrome) values live in memory for the session.
import { HANDOFF_KEY, type Handoff } from "./contract";
import type { StoredValues } from "./types";

type Key = keyof StoredValues;

const memory = new Map<string, unknown>();

/** Looked up per call, so a test can install the fake chrome after import. */
function area(name: "local" | "session"): chrome.storage.StorageArea | null {
  return typeof chrome === "undefined"
    ? null
    : (chrome.storage?.[name] ?? null);
}

/**
 * The caller validates what it reads: a value written by an older version
 * may have another shape than StoredValues says today.
 */
export async function readStored<K extends Key>(
  key: K,
): Promise<StoredValues[K] | undefined> {
  const local = area("local");
  const value = local ? (await local.get(key))[key] : memory.get(key);
  return value as StoredValues[K] | undefined;
}

export async function writeStored<K extends Key>(
  key: K,
  value: StoredValues[K],
): Promise<void> {
  const local = area("local");
  if (local) await local.set({ [key]: value });
  else memory.set(key, value);
}

export async function clearStored(): Promise<void> {
  const local = area("local");
  if (local) await local.clear();
  else memory.clear();
}

function isHandoff(value: unknown): value is Handoff {
  const slot = value as Partial<Record<keyof Handoff, unknown>> | null;
  return (
    typeof slot?.id === "string" &&
    typeof slot.name === "string" &&
    typeof slot.text === "string" &&
    typeof slot.expiresAt === "number"
  );
}

/** Empties the handoff slot and returns it only for the expected id, before it expires. */
export async function takeHandoff(id: string): Promise<Handoff | null> {
  const session = area("session");
  if (!session) return null;
  const slot: unknown = (await session.get(HANDOFF_KEY))[HANDOFF_KEY];
  await session.remove(HANDOFF_KEY);
  return isHandoff(slot) && slot.id === id && slot.expiresAt > Date.now()
    ? slot
    : null;
}
