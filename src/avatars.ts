import { Image } from "@raycast/api";
import { getAvatarIcon } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "./auth";
import { ReadCache } from "./read-cache";
import { saveContactAvatar } from "./saved-conversations";
import { Person, WebexResponseError } from "./webex";

const maxImageBytes = 256 * 1024;
const avatarLifetime = 30 * 60_000;
const missingAvatarLifetime = 60_000;
const profileLookupLifetime = 120_000;
const avatarDownloads = 4;

type AvatarRequest = { id: string; url?: string; savedContact: boolean; savedUrl?: string };
type AvatarJob = { key: string; controller: AbortController };

export function initialAvatar(name: string): Image.Asset {
  const initial = /[\p{L}\p{N}]/u.exec(name)?.[0] ?? "?";
  return getAvatarIcon(initial, { background: "#6B7280", gradient: false });
}

export function avatarIcon(name: string, photo?: string): Image.ImageLike {
  const fallback = initialAvatar(name);
  return photo ? { source: photo, fallback, mask: Image.Mask.Circle } : fallback;
}

export function isAvatarUrl(value?: string): value is string {
  if (!value || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !/^\/default(?:[_.~-]|$)/i.test(url.pathname);
}

async function fetchAvatar(url: string, signal: AbortSignal) {
  for (let remainingRedirects = 3; remainingRedirects >= 0; remainingRedirects--) {
    const response = await fetch(url, { signal, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return { response, url };
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) return;
    url = new URL(location, url).href;
    if (!isAvatarUrl(url)) return;
  }
}

async function downloadAvatar(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const result = await fetchAvatar(url, AbortSignal.any([signal, AbortSignal.timeout(6_000)]));
    if (!result) return null;
    const { response } = result;
    const type = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase()
      .replace(/^image\/jpg$/, "image/jpeg");
    const body = response.body;
    if (!body || !response.ok || !type || !/^image\/(?:jpeg|png|gif|webp|avif|heic|heif|tiff)$/.test(type)) {
      await body?.cancel();
      return null;
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxImageBytes) {
          await reader.cancel();
          return result.url;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return size ? `data:${type};base64,${Buffer.concat(chunks, size).toString("base64")}` : null;
  } catch {
    return null;
  }
}

export function useAvatarImages(
  people: Person[],
  session: Session | undefined,
  savedPeople: Person[],
  { lookupProfiles = false } = {},
): ReadonlyMap<string, string> {
  const [photos] = useState(() => new ReadCache<string | null>(64));
  const [profileUrls] = useState(() => new ReadCache<string | null>(96));
  const [pending] = useState(() => new Map<string, AvatarRequest>());
  const [jobs] = useState(() => new Map<string, AvatarJob>());
  const [images, setImages] = useState<ReadonlyMap<string, string>>(() => new Map());
  const requestKey = useMemo(() => {
    const savedById = new Map(savedPeople.map((person) => [person.id, person]));
    return JSON.stringify(
      people.map(({ id, avatar }): AvatarRequest => {
        const saved = savedById.get(id);
        const savedUrl = saved?.avatar;
        return { id, url: isAvatarUrl(avatar) ? avatar : savedUrl, savedContact: !!saved, savedUrl };
      }),
    );
  }, [people, savedPeople]);

  useEffect(() => {
    return () => {
      for (const { controller } of jobs.values()) controller.abort();
      jobs.clear();
      pending.clear();
    };
  }, [jobs, lookupProfiles, pending, session]);

  useEffect(() => {
    const ready = new Map<string, string>();
    const requests: AvatarRequest[] = JSON.parse(requestKey);
    const keys = new Map(requests.map((request) => [request.id, JSON.stringify(request)]));
    for (const [id, job] of jobs) {
      if (job.key !== keys.get(id)) {
        job.controller.abort();
        jobs.delete(id);
      }
    }
    pending.clear();
    for (const request of requests) {
      const { id, url: avatar, savedContact } = request;
      const url = isAvatarUrl(avatar) && photos.peek(avatar) !== null ? avatar : (profileUrls.peek(id) ?? avatar);
      const cached = isAvatarUrl(url) ? photos.get(url) : undefined;
      if (cached) {
        ready.set(id, cached);
      } else if (
        !jobs.has(id) &&
        ((isAvatarUrl(url) && cached === undefined) || (session && (savedContact || lookupProfiles)))
      ) {
        pending.set(id, request);
      }
    }
    setImages(ready);

    async function loadPhoto(url: string | undefined, signal: AbortSignal): Promise<string | null> {
      if (!isAvatarUrl(url)) return null;
      const cached = photos.get(url);
      if (cached !== undefined) return cached;
      const photo = await downloadAvatar(url, signal);
      if (!signal.aborted) photos.set(url, photo, photo ? avatarLifetime : missingAvatarLifetime);
      return photo;
    }

    async function readProfileUrl(id: string, signal: AbortSignal) {
      if (!session) return;
      const cached = profileUrls.get(id);
      if (cached !== undefined) return cached;
      let url: string | null;
      try {
        const profile = await session.webex.getPerson(id, signal);
        url = isAvatarUrl(profile.avatar) ? profile.avatar : null;
      } catch (error) {
        if (!(error instanceof WebexResponseError) || (error.status !== 403 && error.status !== 404)) return;
        url = null;
      }
      if (!signal.aborted) profileUrls.set(id, url, profileLookupLifetime);
      return url;
    }

    async function load(request: AvatarRequest, signal: AbortSignal) {
      const { id, savedContact, savedUrl } = request;
      let url = request.url;
      let photo = await loadPhoto(url, signal);
      if (signal.aborted) return;

      if (!photo && session && (savedContact || lookupProfiles)) {
        const profileUrl = await readProfileUrl(id, signal);
        if (signal.aborted) return;
        if (profileUrl && profileUrl !== url) {
          url = profileUrl;
          photo = await loadPhoto(url, signal);
        }
      }
      if (signal.aborted || !photo) return;
      if (session && savedContact && isAvatarUrl(url) && url !== savedUrl) {
        void saveContactAvatar(session.person.id, id, url);
      }
      setImages((current) => new Map(current).set(id, photo));
    }

    function startPending() {
      for (const [id, request] of pending) {
        if (jobs.size >= avatarDownloads) break;
        pending.delete(id);
        const job = { key: JSON.stringify(request), controller: new AbortController() };
        jobs.set(id, job);
        void load(request, job.controller.signal)
          .catch(() => {
            // The list uses initials when an avatar cannot be loaded.
          })
          .finally(() => {
            if (jobs.get(id) !== job) return;
            jobs.delete(id);
            startPending();
          });
      }
    }
    startPending();
  }, [jobs, lookupProfiles, pending, photos, profileUrls, requestKey, session]);

  return images;
}
