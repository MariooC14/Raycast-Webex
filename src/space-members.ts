import { isAccountPerson } from "./presentation";
import type { Membership, Person, WebexClient } from "./webex";

export async function findOtherMember(
  webex: WebexClient,
  roomId: string,
  account: Person,
  signal: AbortSignal,
): Promise<Membership | null> {
  const pages = new Set<string>();
  let next: string | undefined;
  do {
    const page = await webex.listMemberships(roomId, signal, next);
    const other = page.items.find(
      ({ personId, personEmail }) =>
        (personId || personEmail) &&
        !isAccountPerson(account, { id: personId, emails: personEmail ? [personEmail] : undefined }),
    );
    if (other) return other;
    next = page.next;
    if (next && pages.has(next)) throw new Error("Webex returned a repeated membership page.");
    if (next) pages.add(next);
  } while (next);
  return null;
}
