import { Action, ActionPanel, Detail, Icon } from "@raycast/api";
import { useCallback } from "react";
import { ComposeMessage } from "./compose-message";
import { ManageConnectionAction } from "./connection";
import { personName, plainTextMarkdown, spaceLink, spaceName } from "./presentation";
import { usePages } from "./use-pages";
import { Person, Space, WebexClient } from "./webex";

export function Conversation({ space, person, webex }: Readonly<{ space: Space; person: Person; webex: WebexClient }>) {
  const load = useCallback(
    (next: string | undefined, signal: AbortSignal, refresh: boolean) =>
      webex.listMessages(space.id, next, signal, refresh),
    [webex, space.id],
  );
  const { items, error, isLoading, reload, loadMore } = usePages(load);
  const name = spaceName(space);
  const messages = items.map((message) => {
    const fallbackText = message.files?.length ? "Attachment" : "Message text unavailable";
    const text = message.text?.trim() ? message.text : fallbackText;
    const sender = message.personEmail || (message.personId === person.id ? personName(person) : "Webex user");
    const sentAt = new Date(message.created);
    const time = Number.isNaN(sentAt.getTime()) ? "" : plainTextMarkdown(sentAt.toLocaleString());
    return `**${plainTextMarkdown(sender)}**\n\n${time}\n\n${plainTextMarkdown(text)}`;
  });
  const markdown = [
    error && plainTextMarkdown(error),
    ...messages,
    !isLoading && !error && items.length === 0 && (loadMore ? "No messages on this page." : "No messages yet."),
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  return (
    <Detail
      navigationTitle={name}
      isLoading={isLoading}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action.Push
            title="Send Message"
            icon={Icon.Message}
            target={
              <ComposeMessage
                webex={webex}
                recipient={{ name, roomId: space.id, direct: space.type === "direct" }}
                onSent={() => void reload()}
              />
            }
          />
          {loadMore && <Action title="Load Older Messages" icon={Icon.ArrowDown} onAction={loadMore} />}
          <Action.Open title="Open in Webex" target={spaceLink(space.id)} icon={Icon.AppWindow} />
          <Action title="Reload Messages" icon={Icon.ArrowClockwise} onAction={reload} />
          <ManageConnectionAction />
        </ActionPanel>
      }
    />
  );
}
