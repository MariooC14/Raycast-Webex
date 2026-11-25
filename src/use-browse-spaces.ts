import { useCallback, useEffect, useState } from "react";
import type { ConnectionPreview, Session } from "./auth";
import { useAvatarImages } from "./avatars";
import { isAccountEmail, isAccountPerson, spaceName } from "./presentation";
import { ReadCache } from "./read-cache";
import { readSavedConversations, SavedConversations } from "./saved-conversations";
import { findOtherMember } from "./space-members";
import { usePages } from "./use-pages";
import type { Membership, Person, Space } from "./webex";

const noPeople: Person[] = [];
const membershipRequests = 3;
const membershipLifetime = 2 * 60_000;

function spaceMatchesAccount(space: Space, account: Person): boolean {
  if (space.errors?.title) return false;
  const name = space.title?.trim().toLowerCase();
  const title = name?.endsWith("(you)") && /\s/.test(name.charAt(name.length - 6)) ? name.slice(0, -5).trimEnd() : name;
  return !!title && (title === account.displayName?.trim().toLowerCase() || isAccountEmail(account, title));
}

function useOtherMembers(session: Session | undefined, roomIds: string[]): ReadonlyMap<string, Membership | null> {
  const [cache] = useState(() => new ReadCache<Membership | null>(150));
  const [result, setResult] = useState<{ accountId: string; members: ReadonlyMap<string, Membership | null> }>();
  const requestKey = JSON.stringify(roomIds);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const { signal } = controller;
    const ready = new Map<string, Membership | null>();
    const pending: string[] = [];
    const accountId = session.person.id;
    const ids: string[] = JSON.parse(requestKey);
    for (const id of ids) {
      const member = cache.get(JSON.stringify([accountId, id]));
      if (member === undefined) pending.push(id);
      else ready.set(id, member);
    }
    setResult({ accountId, members: ready });

    const queue = pending.values();
    const loadMembers = async () => {
      for (const id of queue) {
        if (signal.aborted) return;
        const member = await findOtherMember(session.webex, id, session.person, signal).catch(() => undefined);
        if (signal.aborted) return;
        if (member !== undefined) cache.set(JSON.stringify([accountId, id]), member, membershipLifetime);
        setResult((current) => ({
          accountId,
          members: new Map(current?.members).set(id, member ?? null),
        }));
      }
    };
    for (let worker = 0; worker < Math.min(membershipRequests, pending.length); worker++) {
      void loadMembers();
    }
    return () => controller.abort();
  }, [cache, requestKey, session]);

  return result?.accountId === session?.person.id ? (result?.members ?? new Map()) : new Map();
}

function useSavedConversations(accountId?: string) {
  const [saved, setSaved] = useState<{ accountId: string; conversations: SavedConversations }>();
  useEffect(() => {
    if (!accountId) return;
    let active = true;
    void readSavedConversations(accountId).then((conversations) => {
      if (active) setSaved({ accountId, conversations });
    });
    return () => {
      active = false;
    };
  }, [accountId]);
  return saved?.accountId === accountId ? saved?.conversations : undefined;
}

function findSpaces(displayed: Space[], known: Space[] | undefined, query: string) {
  const candidates =
    query && known?.length
      ? [...new Map([...known, ...displayed].map((space) => [space.id, space])).values()]
      : displayed;
  return candidates
    .filter((space) => spaceName(space).toLocaleLowerCase().includes(query))
    .sort((a, b) => (b.lastActivity ?? b.created ?? "").localeCompare(a.lastActivity ?? a.created ?? ""));
}

function useSpaceMembers(
  spaces: Space[],
  session: Session | undefined,
  account: Person | undefined,
  saved?: SavedConversations,
) {
  const savedPeople = saved?.people ?? noPeople;
  const savedById = new Map(savedPeople.map((person) => [person.id, person]));
  const accountNamed = account ? spaces.filter((space) => spaceMatchesAccount(space, account)) : [];
  const accountNamedIds = new Set(accountNamed.map(({ id }) => id));
  const peopleByRoom = new Map<string, Person>();

  for (const { id, type } of spaces) {
    if (type !== "direct") continue;
    const person = saved?.directRooms.get(id)?.person;
    if (person && !isAccountPerson(account, person)) peopleByRoom.set(id, savedById.get(person.id) ?? person);
  }

  const members = useOtherMembers(
    session,
    spaces
      .filter(({ id, type }) => (type === "direct" || accountNamedIds.has(id)) && !peopleByRoom.has(id))
      .map(({ id }) => id),
  );
  for (const { id, type } of spaces) {
    if (type !== "direct" || peopleByRoom.has(id)) continue;
    const member = members.get(id);
    if (member?.personId) peopleByRoom.set(id, savedById.get(member.personId) ?? { id: member.personId });
  }

  const directPeople = [...new Map([...peopleByRoom.values()].map((person) => [person.id, person])).values()];
  const avatars = useAvatarImages(directPeople, session, savedPeople, { lookupProfiles: true });
  return {
    peopleByRoom,
    avatars,
    checkingMembership: !!session && accountNamed.some(({ id }) => !peopleByRoom.has(id) && !members.has(id)),
    visibleSpaces: spaces.filter(({ id }) => !accountNamedIds.has(id) || peopleByRoom.has(id) || !!members.get(id)),
  };
}

export function useBrowseSpaces(session?: Session, preview?: ConnectionPreview) {
  const [search, setSearch] = useState("");
  const webex = session?.webex;
  const account = session?.person ?? preview?.account;
  const load = useCallback(
    async (next: string | undefined, signal: AbortSignal, refresh: boolean) =>
      webex?.listSpaces(next, signal, refresh) ?? { items: [] },
    [webex],
  );
  const page = usePages(load, { enabled: !!webex });
  const saved = useSavedConversations(session?.person.id) ?? preview?.conversations;
  const displayed = page.hasLoaded ? page.items : (preview?.spaces?.items ?? page.items);
  const query = search.trim().toLocaleLowerCase();
  const accountKnown = session || account?.displayName || account?.emails?.length;
  const candidates = accountKnown ? findSpaces(displayed, saved?.spaces, query) : [];
  const {
    visibleSpaces: spaces,
    checkingMembership,
    peopleByRoom,
    avatars,
  } = useSpaceMembers(candidates, session, account, saved);
  const connecting = !session && preview?.spaces !== undefined;
  const isLoading =
    spaces.length === 0 && ((displayed.length === 0 && (connecting || page.isLoading)) || checkingMembership);

  return {
    search,
    setSearch,
    spaces,
    peopleByRoom,
    avatars,
    isLoading,
    connecting,
    hasSearched: !!query,
    showEmptyResult: page.hasLoaded && !page.isLoading && !checkingMembership,
    error: page.error,
    reload: page.reload,
    loadMore: page.loadMore,
  };
}
