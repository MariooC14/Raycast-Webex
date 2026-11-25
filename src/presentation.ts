import { Person, Space } from "./webex";

export function personName(person: Person): string {
  return person.displayName || person.emails?.[0] || "Webex user";
}

export function isAccountEmail(account: Person | undefined, email: string): boolean {
  const address = email.trim().toLowerCase();
  return !!address && (account?.emails?.some((ownEmail) => ownEmail.toLowerCase() === address) ?? false);
}

export function isAccountPerson(account: Person | undefined, person: Pick<Person, "id" | "emails">): boolean {
  return (
    !!account && (account.id === person.id || (person.emails?.some((email) => isAccountEmail(account, email)) ?? false))
  );
}

export function spaceName(space: Space): string {
  return (space.errors?.title ? undefined : space.title) || "Untitled Space";
}

export function spaceLink(roomId: string): string {
  // The REST API encodes resource IDs. Webex's app link uses the space UUID.
  const decoded = Buffer.from(roomId, "base64url").toString("utf8");
  const id = /^ciscospark:\/\/[^/]+\/ROOM\/([0-9a-f-]+)$/i.exec(decoded)?.[1] ?? roomId;
  return `webexteams://im?space=${encodeURIComponent(id)}`;
}

export function chatLink(email: string): string {
  return `webexteams://im?email=${encodeURIComponent(email)}`;
}

export function plainTextMarkdown(text: string): string {
  return text
    .replace(/[\\`*_{}[\]()<>#+.!|~&-]/g, "\\$&")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "  \n");
}
