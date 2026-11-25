import { Action, ActionPanel, Icon, List } from "@raycast/api";
import type { ConnectionPreview, Session } from "./auth";
import { avatarIcon } from "./avatars";
import { ComposeMessage } from "./compose-message";
import { Connection, ManageConnectionAction } from "./connection";
import { Conversation } from "./conversation";
import { spaceLink, spaceName } from "./presentation";
import { useBrowseSpaces } from "./use-browse-spaces";

export default function BrowseSpaces() {
  return (
    <Connection previewView="spaces">{(session, preview) => <Spaces session={session} preview={preview} />}</Connection>
  );
}

function Spaces({ session, preview }: Readonly<{ session?: Session; preview?: ConnectionPreview }>) {
  const {
    search,
    setSearch,
    spaces,
    peopleByRoom,
    avatars,
    isLoading,
    connecting,
    hasSearched,
    showEmptyResult,
    error,
    reload,
    loadMore,
  } = useBrowseSpaces(session, preview);
  const emptyTitle = spaceListTitle(error, showEmptyResult, hasSearched, isLoading, connecting);

  const refreshAction = <Action title="Refresh Results" icon={Icon.ArrowClockwise} onAction={reload} />;
  const loadMoreAction = loadMore && <Action title="Load More Spaces" icon={Icon.ArrowDown} onAction={loadMore} />;
  const showLoadMoreRow = !hasSearched && !!loadMore;
  const viewActions = session && (
    <ActionPanel>
      {refreshAction}
      {hasSearched && loadMoreAction}
      <ManageConnectionAction />
    </ActionPanel>
  );

  return (
    <List
      actions={viewActions}
      isLoading={isLoading}
      filtering={false}
      searchText={search}
      onSearchTextChange={setSearch}
      searchBarPlaceholder="Filter loaded spaces"
    >
      <List.EmptyView
        title={emptyTitle}
        icon={emptyTitle ? undefined : null}
        description={error}
        actions={viewActions}
      />
      {spaces.map((space) => {
        const name = spaceName(space);
        const person = peopleByRoom.get(space.id);
        return (
          <List.Item
            key={space.id}
            title={name}
            icon={avatarIcon(name, person && avatars.get(person.id))}
            subtitle={space.type === "direct" ? "Direct" : "Group"}
            accessories={space.lastActivity ? [{ date: new Date(space.lastActivity), tooltip: "Last activity" }] : []}
            actions={
              session && (
                <ActionPanel>
                  <Action.Push
                    title="Read Messages"
                    icon={Icon.Message}
                    target={<Conversation space={space} person={session.person} webex={session.webex} />}
                  />
                  <Action.Push
                    title="Send Message"
                    icon={Icon.Pencil}
                    target={
                      <ComposeMessage
                        webex={session.webex}
                        recipient={{ name, roomId: space.id, direct: space.type === "direct" }}
                        onSent={() => void reload()}
                      />
                    }
                  />
                  <Action.Open title="Open in Webex" target={spaceLink(space.id)} icon={Icon.AppWindow} />
                  {refreshAction}
                  {hasSearched && loadMoreAction}
                  <ManageConnectionAction />
                </ActionPanel>
              )
            }
          />
        );
      })}
      {showLoadMoreRow && (
        <List.Item
          title="Load More Spaces"
          subtitle={error}
          icon={Icon.ArrowDown}
          actions={
            <ActionPanel>
              {loadMoreAction}
              {refreshAction}
              <ManageConnectionAction />
            </ActionPanel>
          }
        />
      )}
      {error && spaces.length > 0 && !showLoadMoreRow && (
        <List.Item title="Could Not Reload Spaces" subtitle={error} icon={Icon.ExclamationMark} actions={viewActions} />
      )}
    </List>
  );
}

function spaceListTitle(
  error: string | undefined,
  showEmptyResult: boolean,
  hasSearched: boolean,
  isLoading: boolean,
  connecting: boolean,
) {
  if (error) return "Could Not Load Spaces";
  if (showEmptyResult) return hasSearched ? "No Matching Spaces" : "No Spaces Yet";
  if (isLoading) return connecting ? "Connecting to Webex" : "Loading Spaces";
  return "";
}
