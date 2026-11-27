import { createHash } from "node:crypto";
import { LocalStorage } from "@raycast/api";
import type { Person, Space } from "./webex";

const accountKey = "webex-conversation-account";
const conversationsPrefix = "webex-conversations:";

export type DirectRoomCheck = { lastActivity?: string; person?: Person };
export type SavedConversations = {
  people: Person[];
  spaces: Space[];
  directRooms: Map<string, DirectRoomCheck>;
  lastSync: number;
};

function accountPrefix(accountId: string): string {
  return `${conversationsPrefix}${accountId}:`;
}

export function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parse<T>(value: LocalStorage.Value | undefined): T | undefined {
  if (typeof value !== "string") return;
  try {
    return JSON.parse(value) as T;
  } catch {
    // Ignore cache entries that cannot be read.
  }
}

async function save(key: string, value: object | number) {
  await LocalStorage.setItem(key, typeof value === "number" ? value : JSON.stringify(value)).catch(() => undefined);
}

// Requests that finish after sign-out or an account switch must not restore cleared data.
async function isRememberedAccount(accountId: string): Promise<boolean> {
  const value = await LocalStorage.getItem<string>(accountKey).catch(() => undefined);
  return parse<{ accountId?: string }>(value)?.accountId === accountId;
}

async function saveForAccount(accountId: string, entries: [key: string, value: object | number][]) {
  if (!(await isRememberedAccount(accountId))) return;
  const prefix = accountPrefix(accountId);
  await Promise.all(entries.map(([key, value]) => save(prefix + key, value)));
}

export async function rememberConversationAccount(person: Person, token: string) {
  const { id: accountId, displayName, emails } = person;
  await save(accountKey, { accountId, displayName, emails, credential: fingerprint(token) });
}

export async function getConversationAccount(token: string): Promise<Person | undefined> {
  const value = await LocalStorage.getItem<string>(accountKey).catch(() => undefined);
  const account = parse<{ accountId: string; displayName?: string; emails?: string[]; credential: string }>(value);
  if (account?.credential === fingerprint(token) && account.accountId) {
    return { id: account.accountId, displayName: account.displayName, emails: account.emails };
  }
}

export async function forgetConversationAccount(token?: string) {
  if (token && !(await getConversationAccount(token))) return;
  await LocalStorage.removeItem(accountKey).catch(() => undefined);
}

export async function clearSavedConversations() {
  const values: Record<string, LocalStorage.Value> = await LocalStorage.allItems().catch(() => ({}));
  const keys = Object.keys(values).filter((key) => key.startsWith(conversationsPrefix));
  await Promise.all([accountKey, ...keys].map((key) => LocalStorage.removeItem(key).catch(() => undefined)));
}

function* readEntries<T>(entries: [string, LocalStorage.Value][], prefix: string) {
  for (const [key, value] of entries) {
    if (!key.startsWith(prefix)) continue;
    const entry = parse<T>(value);
    if (entry) yield [key.slice(prefix.length), entry] as const;
  }
}

export async function readSavedConversations(accountId: string): Promise<SavedConversations> {
  const prefix = accountPrefix(accountId);
  const values: Record<string, LocalStorage.Value> = await LocalStorage.allItems().catch(() => ({}));
  const entries = Object.entries(values);
  const directRooms = new Map(readEntries<DirectRoomCheck>(entries, `${prefix}direct:`));
  const people = new Map<string, Person>();
  for (const { person } of directRooms.values()) {
    if (person?.id) people.set(person.id, person);
  }
  for (const [, person] of readEntries<Person>(entries, `${prefix}person:`)) {
    if (person.id) people.set(person.id, { ...people.get(person.id), ...person });
  }
  for (const [id, { url }] of readEntries<{ url: string }>(entries, `${prefix}avatar:`)) {
    const person = people.get(id);
    if (person && url) people.set(id, { ...person, avatar: url });
  }

  const spaces = [...readEntries<Space>(entries, `${prefix}space:`)].map(([, space]) => space).filter(({ id }) => id);
  const lastSync = values[`${prefix}last-sync`];
  return { people: [...people.values()], spaces, directRooms, lastSync: typeof lastSync === "number" ? lastSync : 0 };
}

export async function saveJoinedSpaces(accountId: string, spaces: Space[]) {
  await saveForAccount(
    accountId,
    spaces.map(({ id, title, type, lastActivity, created, errors }) => [
      `space:${id}`,
      { id, title: errors?.title ? undefined : title, type, lastActivity, created },
    ]),
  );
}

export async function saveDirectContact(accountId: string, person: Person) {
  const { id, displayName, emails, avatar } = person;
  await saveForAccount(accountId, [[`person:${id}`, { id, displayName, emails, avatar }]]);
}

export async function saveContactAvatar(accountId: string, personId: string, url: string) {
  await saveForAccount(accountId, [[`avatar:${personId}`, { url }]]);
}

export async function saveDirectRoomCheck(accountId: string, roomId: string, check: DirectRoomCheck) {
  await saveForAccount(accountId, [[`direct:${roomId}`, check]]);
}

export async function finishConversationSync(accountId: string, removedSpaces: Space[]) {
  const prefix = accountPrefix(accountId);
  const removed = removedSpaces.map(({ id }) => `space:${id}`);
  await Promise.all(removed.map((key) => LocalStorage.removeItem(prefix + key).catch(() => undefined)));
  await saveForAccount(accountId, [["last-sync", Date.now()]]);
}
