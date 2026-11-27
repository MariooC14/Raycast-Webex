import { discardBody, fetchWithTimeout, readJson } from "./http";
import { ReadCache } from "./read-cache";
import { saveDirectContact, saveDirectRoomCheck, saveJoinedSpaces } from "./saved-conversations";
import { clearSavedSpaces, readSavedSpaces, saveSpaces, spacePageLifetime } from "./saved-spaces";

const apiBase = new URL("https://webexapis.com/v1/");
const pageSize = "50";
const requestTimeout = 15_000;
const uncertainDelivery = "Webex may have received the message. Check the conversation before sending again.";

export type Person = {
  id: string;
  displayName?: string;
  emails?: string[];
  avatar?: string;
};

export type Space = {
  id: string;
  title?: string;
  type: "direct" | "group";
  lastActivity?: string;
  created?: string;
  errors?: { title?: unknown };
};

export type Message = {
  id: string;
  text?: string;
  personId?: string;
  personEmail?: string;
  created: string;
  files?: string[];
};

export type Recipient = { name: string } & ({ roomId: string; direct?: boolean } | { person: Person });

export type Membership = { id: string; personId: string; personEmail?: string; personDisplayName?: string };

export type Page<T> = {
  items: T[];
  next?: string;
};

export class SignInRequired extends Error {
  constructor(message = "Sign in again using Manage Webex Connection.") {
    super(message);
  }
}

export class WebexResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

class DirectoryNameSearchRestricted extends Error {}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Webex could not complete the request.";
}

function nextLink(header: string | null): string | undefined {
  for (const [, url, parameters] of header?.matchAll(/<([^<>]+)>([^<]*)/g) ?? []) {
    if (parameters.split(/[;,]/).some((parameter) => /^rel\s*=\s*(?:"next"|next)$/i.test(parameter.trim()))) {
      return url;
    }
  }
}

function peopleSearchPath(query: string, byEmail: boolean): string {
  const parameters = new URLSearchParams({ [byEmail ? "email" : "displayName"]: query, max: pageSize });
  return `people?${parameters}`;
}

function isDirectoryNameSearchError(body: unknown): boolean {
  const { message, errors } = (body ?? {}) as { message?: unknown; errors?: { description?: unknown }[] };
  const descriptions = Array.isArray(errors) ? errors.map((error) => error?.description) : [];
  return [message, ...descriptions].some(
    (value) => typeof value === "string" && /displayname/i.test(value) && /consumer/i.test(value),
  );
}

const readErrors = {
  timeout: "Webex took too long to respond. Try again.",
  connection: "Could not reach Webex. Check your connection and try again.",
};
const sendErrors = { timeout: uncertainDelivery, connection: uncertainDelivery };

function retryTime(header: string | null): number {
  if (!header) return 0;
  if (/^\d+$/.test(header)) return Date.now() + Number(header) * 1000;
  return Date.parse(header);
}

export class WebexClient {
  private readonly spaces = new ReadCache<Page<Space>>(12);
  private readonly messages = new ReadCache<Page<Message>>(24);
  private readonly people = new ReadCache<Page<Person>>(12);
  private nameSearchRestricted = false;
  private retryAt = 0;

  constructor(
    private readonly accessToken: (signal?: AbortSignal) => Promise<string>,
    private readonly accountId?: string,
  ) {}

  createBackgroundClient(): WebexClient {
    return new WebexClient(this.accessToken, this.accountId);
  }

  async getMe(signal?: AbortSignal): Promise<Person> {
    const { body } = await this.request("people/me", { signal });
    const person = body as Person | undefined;
    if (typeof person?.id !== "string" || !person.id) {
      throw new Error("Webex could not identify the signed-in account.");
    }
    return person;
  }

  async getPerson(personId: string, signal: AbortSignal): Promise<Person> {
    const { body } = await this.request(`people/${encodeURIComponent(personId)}`, { signal });
    const person = body as Person | undefined;
    if (person?.id !== personId) throw new Error("Webex returned an unreadable profile.");
    return person;
  }

  async listSpaces(next?: string, signal?: AbortSignal, refresh = false): Promise<Page<Space>> {
    const path = next ?? `rooms?sortBy=lastactivity&max=${pageSize}`;
    if (next) {
      const page = await this.getPage(this.spaces, path, spacePageLifetime, refresh, signal);
      return this.rememberSpaces(page, signal);
    }

    const token = await this.accessToken(signal);
    signal?.throwIfAborted();
    if (!refresh) {
      const saved = await readSavedSpaces(token);
      signal?.throwIfAborted();
      if (saved?.fresh) return this.rememberSpaces(saved.page, signal);
    }
    const requestedAt = Date.now();
    this.spaces.clear();
    const page = await this.fetchPage<Space>(path, signal, token);
    if (!signal?.aborted) await saveSpaces(token, page, requestedAt);
    return this.rememberSpaces(page, signal);
  }

  private rememberSpaces(page: Page<Space>, signal?: AbortSignal): Page<Space> {
    if (this.accountId && !signal?.aborted) void saveJoinedSpaces(this.accountId, page.items);
    return page;
  }

  listMessages(roomId: string, next?: string, signal?: AbortSignal, refresh = false): Promise<Page<Message>> {
    const query = new URLSearchParams({ roomId, max: pageSize });
    return this.getPage(this.messages, next ?? `messages?${query}`, next ? 300_000 : 30_000, refresh, signal);
  }

  listMemberships(roomId: string, signal: AbortSignal, next?: string): Promise<Page<Membership>> {
    return this.fetchPage<Membership>(next ?? `memberships?${new URLSearchParams({ roomId })}`, signal);
  }

  getCachedPeople(query: string, byEmail: boolean): Page<Person> | undefined {
    if (!byEmail && this.nameSearchRestricted) return;
    return this.people.peek(peopleSearchPath(query, byEmail));
  }

  get isNameSearchRestricted(): boolean {
    return this.nameSearchRestricted;
  }

  async findPeople(
    query: string,
    byEmail: boolean,
    next?: string,
    signal?: AbortSignal,
    refresh = false,
  ): Promise<Page<Person>> {
    if (!byEmail && this.nameSearchRestricted && !refresh) return { items: [] };
    try {
      const page = await this.getPage(this.people, next ?? peopleSearchPath(query, byEmail), 120_000, refresh, signal);
      if (!byEmail) this.nameSearchRestricted = false;
      return page;
    } catch (error) {
      if (byEmail || !(error instanceof DirectoryNameSearchRestricted)) throw error;
      signal?.throwIfAborted();
      this.nameSearchRestricted = true;
      return { items: [] };
    }
  }

  async sendMessage(recipient: Recipient, text: string): Promise<void> {
    const target = "roomId" in recipient ? { roomId: recipient.roomId } : { toPersonId: recipient.person.id };
    await this.request("messages", { method: "POST", body: JSON.stringify({ ...target, text }) });
    this.spaces.clear();
    this.messages.clear();
    const accountId = this.accountId;
    if (accountId) {
      if ("person" in recipient && recipient.person.id !== accountId) {
        await saveDirectContact(accountId, recipient.person);
      } else if ("roomId" in recipient && recipient.direct) {
        void this.listMemberships(recipient.roomId, AbortSignal.timeout(requestTimeout))
          .then(async ({ items }) => {
            const other = items.find(({ personId }) => personId && personId !== accountId);
            if (other) {
              await saveDirectRoomCheck(accountId, recipient.roomId, {
                person: {
                  id: other.personId,
                  displayName: other.personDisplayName || recipient.name,
                  emails: other.personEmail ? [other.personEmail] : undefined,
                },
              });
            }
          })
          .catch(() => undefined);
      }
    }
    await clearSavedSpaces();
  }

  private async getPage<T extends { id: string }>(
    cache: ReadCache<Page<T>>,
    path: string,
    lifetime: number,
    refresh: boolean,
    signal?: AbortSignal,
  ): Promise<Page<T>> {
    const accessToken = await this.accessToken(signal);
    signal?.throwIfAborted();
    if (refresh) cache.clear();
    const cached = cache.get(path);
    if (cached) return cached;

    const version = cache.version;
    const result = await this.fetchPage<T>(path, signal, accessToken);
    if (!signal?.aborted && version === cache.version) cache.set(path, result, lifetime);
    return result;
  }

  private async fetchPage<T extends { id: string }>(
    path: string,
    signal?: AbortSignal,
    token?: string,
  ): Promise<Page<T>> {
    const { body, headers } = await this.request(path, { signal }, token);
    const page = body as { items?: T[] } | undefined;
    if (!Array.isArray(page?.items)) throw new Error("Webex did not return a list.");
    return {
      items: page.items.filter((item) => typeof item?.id === "string"),
      next: nextLink(headers.get("link")),
    };
  }

  private async request(
    path: string,
    options: { method?: "POST"; body?: string; signal?: AbortSignal },
    token?: string,
  ) {
    const url = new URL(path, apiBase);
    if (url.origin !== apiBase.origin || !url.pathname.startsWith("/v1/") || url.username || url.password) {
      throw new Error("Webex returned an invalid page link.");
    }

    this.checkRateLimit();
    const accessToken = token ?? (await this.accessToken(options.signal));
    options.signal?.throwIfAborted();
    this.checkRateLimit();
    const sending = options.method === "POST";
    const isNameSearch = url.pathname === "/v1/people" && url.searchParams.has("displayName");
    const { response, body } = await fetchWithTimeout(
      url,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...(sending ? { "Content-Type": "application/json" } : {}),
        },
      },
      async (response, signal) => {
        if ((!sending && response.ok) || (isNameSearch && response.status === 400)) {
          return { response, body: await readJson(response, signal) };
        }
        discardBody(response);
        return { response };
      },
      sending ? sendErrors : readErrors,
    );
    if (isNameSearch && response.status === 400 && isDirectoryNameSearchError(body)) {
      throw new DirectoryNameSearchRestricted();
    }
    this.checkResponse(response, sending);
    return { body, headers: response.headers };
  }

  private checkResponse({ ok, status, headers }: Response, sending: boolean) {
    if (ok) return;
    if (status === 401) throw new SignInRequired();
    if (status === 403) {
      throw new WebexResponseError("Webex denied access. Your account or organization may restrict this action.", 403);
    }
    if (status === 404) throw new WebexResponseError("Webex could not find this person or space.", 404);
    if (status === 429) {
      const retryAt = retryTime(headers.get("retry-after"));
      if (Number.isFinite(retryAt)) this.retryAt = Math.max(this.retryAt, retryAt);
      this.checkRateLimit();
      throw new Error("Webex is receiving too many requests. Try again shortly.");
    }
    if (sending && (status === 408 || status >= 500)) {
      throw new Error(uncertainDelivery);
    }
    throw new Error(`Webex could not complete the request (HTTP ${status}).`);
  }

  private checkRateLimit() {
    const seconds = Math.ceil((this.retryAt - Date.now()) / 1000);
    if (seconds > 0) {
      throw new Error(`Webex is receiving too many requests. Try again in ${seconds} seconds.`);
    }
  }
}
