import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConnectionPreview, Session } from "./auth";
import { isAvatarUrl, useAvatarImages } from "./avatars";
import { syncConversations } from "./conversation-sync";
import { isAccountEmail, isAccountPerson, personName } from "./presentation";
import { readSavedConversations } from "./saved-conversations";
import { usePages } from "./use-pages";
import type { Person } from "./webex";

const noPeople: Person[] = [];

function isCompleteEmail(query: string): boolean {
  const parts = query.split("@");
  if (parts.length !== 2 || /\s/.test(query)) return false;
  const [user, domain] = parts;
  if (!user || !domain) return false;
  const dot = domain.indexOf(".", 1);
  return dot !== -1 && dot < domain.length - 1;
}

function mergePeople(account: Person | undefined, remembered: Person[], directory: Person[], query: string) {
  if (query.length < 2) return noPeople;
  const term = query.toLocaleLowerCase();
  const matches = new Map<string, Person>();
  for (const person of remembered) {
    if (isAccountPerson(account, person)) continue;
    if (
      personName(person).toLocaleLowerCase().includes(term) ||
      person.emails?.some((email) => email.toLocaleLowerCase().includes(term))
    ) {
      matches.set(person.id, person);
    }
  }
  for (const person of directory) {
    if (isAccountPerson(account, person)) continue;
    const saved = matches.get(person.id);
    const avatar = isAvatarUrl(person.avatar) ? person.avatar : saved?.avatar;
    matches.set(person.id, { ...saved, ...person, avatar });
  }
  return [...matches.values()];
}

function useDirectContacts(session?: Session) {
  const [saved, setSaved] = useState<{ accountId: string; people: Person[] }>();
  const account = session?.person;
  const rememberPerson = useCallback(
    (person: Person) => {
      if (!account || isAccountPerson(account, person)) return;
      setSaved((previous) => {
        const people = previous?.accountId === account.id ? previous.people : noPeople;
        return { accountId: account.id, people: [person, ...people.filter(({ id }) => id !== person.id)] };
      });
    },
    [account],
  );

  useEffect(() => {
    if (!session) return;
    const { person, webex } = session;
    const controller = new AbortController();
    const { signal } = controller;
    void readSavedConversations(person.id)
      .then(async (saved) => {
        if (signal.aborted) return;
        setSaved({ accountId: person.id, people: saved.people });
        await syncConversations(webex, person, saved, signal, rememberPerson);
      })
      .catch(() => {
        // Directory search is still available when history cannot be loaded.
      });
    return () => controller.abort();
  }, [rememberPerson, session]);

  return { savedPeople: saved?.accountId === account?.id ? saved?.people : undefined, rememberPerson };
}

export function useFindPeople(session?: Session, preview?: ConnectionPreview) {
  const webex = session?.webex;
  const account = session?.person ?? preview?.account;
  const [search, setSearch] = useState("");
  const query = search.trim();
  const isEmailSearch = query.includes("@");
  const isFullEmail = isCompleteEmail(query);
  const enabled = !!webex && (isEmailSearch ? isFullEmail : query.length >= 2);
  const load = useCallback(
    async (next: string | undefined, signal: AbortSignal, refresh: boolean) =>
      webex?.findPeople(query, isEmailSearch, next, signal, refresh) ?? { items: [] },
    [query, isEmailSearch, webex],
  );
  const page = usePages(load, { enabled, delay: 300 });
  const { savedPeople, rememberPerson } = useDirectContacts(session);
  const cachedPeople =
    enabled && !page.hasLoaded && !page.error ? webex?.getCachedPeople(query, isEmailSearch) : undefined;
  const remembered = savedPeople ?? preview?.conversations?.people ?? noPeople;
  const directory = cachedPeople?.items ?? page.items;
  const people = useMemo(
    () => mergePeople(account, remembered, directory, query),
    [account, directory, query, remembered],
  );
  const avatarImages = useAvatarImages(people, session, remembered);
  const readingSavedPeople = enabled && savedPeople === undefined && !preview?.conversations;
  const isLoading = (page.isLoading && !cachedPeople) || (readingSavedPeople && people.length === 0);
  const noMatches =
    page.hasLoaded && !page.isLoading && !readingSavedPeople && !page.error && !page.loadMore && people.length === 0;
  const showEmailFallback =
    noMatches &&
    isFullEmail &&
    !isAccountEmail(account, query) &&
    !directory.some((person) => isAccountPerson(account, person));

  return {
    search,
    setSearch,
    query,
    isEmailSearch,
    isFullEmail,
    enabled,
    people,
    avatarImages,
    rememberPerson,
    isLoading,
    noMatches,
    showEmailFallback,
    error: page.error,
    reload: page.reload,
    loadMore: page.loadMore,
  };
}
