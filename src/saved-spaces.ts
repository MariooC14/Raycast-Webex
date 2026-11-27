import { LocalStorage } from "@raycast/api";
import { fingerprint } from "./saved-conversations";
import type { Page, Space } from "./webex";

const spacesKey = "webex-first-space-page";
const invalidatedKey = "webex-spaces-invalidated-at";
export const spacePageLifetime = 60_000;
const savedPageLifetime = 24 * 60 * 60_000;

type SavedSpaces = { credential: string; requestedAt: number; savedAt: number; page: Page<Space> };

export async function readSavedSpaces(token: string): Promise<{ page: Page<Space>; fresh: boolean } | undefined> {
  try {
    const [value, invalidatedAt] = await Promise.all([
      LocalStorage.getItem<string>(spacesKey),
      LocalStorage.getItem<number>(invalidatedKey),
    ]);
    if (!value) return;
    const saved: SavedSpaces = JSON.parse(value);
    const age = Date.now() - saved.savedAt;
    if (
      saved.credential === fingerprint(token) &&
      age < savedPageLifetime &&
      saved.requestedAt > (invalidatedAt ?? 0)
    ) {
      return { page: saved.page, fresh: age < spacePageLifetime };
    }
  } catch {
    // Fetch from Webex if local storage is unavailable.
  }
}

export async function saveSpaces(token: string, page: Page<Space>, requestedAt: number) {
  const snapshot = JSON.stringify({ credential: fingerprint(token), page, requestedAt, savedAt: Date.now() });
  await LocalStorage.setItem(spacesKey, snapshot).catch(() => undefined);
}

export async function clearSavedSpaces() {
  await LocalStorage.setItem(invalidatedKey, Date.now()).catch(() => undefined);
  await LocalStorage.removeItem(spacesKey).catch(() => undefined);
}
