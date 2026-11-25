import { setTimeout } from "node:timers/promises";
import { finishConversationSync, SavedConversations, saveDirectRoomCheck } from "./saved-conversations";
import { findOtherMember } from "./space-members";
import { Message, Person, Space, WebexClient, WebexResponseError } from "./webex";

const syncInterval = 10 * 60_000;
const requestInterval = 300;

function isAuthor(message: Message, person: Person): boolean {
  if (message.personId) return message.personId === person.id;
  return (
    !!message.personEmail &&
    !!person.emails?.some((email) => email.toLowerCase() === message.personEmail?.toLowerCase())
  );
}

function otherMessageAuthor(messages: Message[], account: Person, displayName?: string): Person | undefined {
  const other = messages.find((message) => message.personId && !isAuthor(message, account));
  if (!other?.personId) return;
  return { id: other.personId, displayName, emails: other.personEmail ? [other.personEmail] : undefined };
}

async function readOtherMember(webex: WebexClient, space: Space, account: Person, signal: AbortSignal) {
  await setTimeout(requestInterval, undefined, { signal });
  try {
    const other = await findOtherMember(webex, space.id, account, signal);
    if (!other?.personId) return;
    return {
      id: other.personId,
      displayName: other.personDisplayName || (space.errors?.title ? undefined : space.title),
      emails: other.personEmail ? [other.personEmail] : undefined,
    };
  } catch (error) {
    if (!roomIsUnavailable(error)) throw error;
  }
}

async function checkDirectSpace(webex: WebexClient, space: Space, account: Person, signal: AbortSignal) {
  const displayName = space.errors?.title ? undefined : space.title;
  let sent = false;
  let otherPerson: Person | undefined;
  let triedMemberships = false;
  let next: string | undefined;
  const pages = new Set<string>();

  do {
    await setTimeout(requestInterval, undefined, { signal });
    const page = await webex.listMessages(space.id, next, signal);
    sent ||= page.items.some((message) => isAuthor(message, account));
    otherPerson ??= otherMessageAuthor(page.items, account, displayName);
    if (sent && !otherPerson && !triedMemberships) {
      triedMemberships = true;
      otherPerson = await readOtherMember(webex, space, account, signal);
    }
    if (sent && otherPerson) return { sent, person: otherPerson };
    next = page.next;
    if (next && pages.has(next)) throw new Error("Webex returned a repeated message page.");
    if (next) pages.add(next);
  } while (next);

  return { sent, person: undefined };
}

function roomIsUnavailable(error: unknown): boolean {
  return error instanceof WebexResponseError && (error.status === 403 || error.status === 404);
}

async function syncSpace(
  webex: WebexClient,
  space: Space,
  account: Person,
  saved: SavedConversations,
  signal: AbortSignal,
) {
  if (space.type !== "direct") return;
  const previous = saved.directRooms.get(space.id);
  if (previous?.person || (space.lastActivity && previous?.lastActivity === space.lastActivity)) return;

  try {
    const { sent, person } = await checkDirectSpace(webex, space, account, signal);
    signal.throwIfAborted();
    if (!sent || person) await saveDirectRoomCheck(account.id, space.id, { lastActivity: space.lastActivity, person });
    return person;
  } catch (error) {
    if (!roomIsUnavailable(error)) throw error;
  }
}

export async function syncConversations(
  webex: WebexClient,
  account: Person,
  saved: SavedConversations,
  signal: AbortSignal,
  onContact: (person: Person) => void,
) {
  if (Date.now() - saved.lastSync < syncInterval) return;

  const seen = new Set<string>();
  const pages = new Set<string>();
  let next: string | undefined;
  for (;;) {
    await setTimeout(requestInterval, undefined, { signal });
    const page = await webex.listSpaces(next, signal);
    for (const space of page.items) {
      signal.throwIfAborted();
      if (seen.has(space.id)) continue;
      seen.add(space.id);
      const person = await syncSpace(webex, space, account, saved, signal);
      if (person && !signal.aborted) onContact(person);
    }
    next = page.next;
    if (!next) break;
    if (pages.has(next)) throw new Error("Webex returned a repeated space page.");
    pages.add(next);
  }

  signal.throwIfAborted();
  await finishConversationSync(
    account.id,
    saved.spaces.filter(({ id }) => !seen.has(id)),
  );
}
