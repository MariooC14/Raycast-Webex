import { Action, ActionPanel, Icon, List } from "@raycast/api";
import type { ConnectionPreview, Session } from "./auth";
import { avatarIcon, initialAvatar } from "./avatars";
import { ComposeMessage } from "./compose-message";
import { Connection, ManageConnectionAction } from "./connection";
import { chatLink, personName } from "./presentation";
import { useFindPeople } from "./use-find-people";

export default function FindPeople() {
  return (
    <Connection previewView="people">{(session, preview) => <People session={session} preview={preview} />}</Connection>
  );
}

function People({ session, preview }: Readonly<{ session?: Session; preview?: ConnectionPreview }>) {
  const webex = session?.webex;
  const {
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
    error,
    reload,
    loadMore,
  } = useFindPeople(session, preview);
  const emptyTitle = peopleListTitle(!webex && !!preview, error, !!webex && !enabled, isLoading, noMatches);
  const searchPrompt = isEmailSearch ? "Enter a full email address." : "Enter a name or email.";
  const emptyDescription = webex && !enabled ? searchPrompt : error;

  const refreshAction = enabled && <Action title="Refresh Results" icon={Icon.ArrowClockwise} onAction={reload} />;
  const viewActions = webex && (
    <ActionPanel>
      {refreshAction}
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
      searchBarPlaceholder="Search by name or exact email"
    >
      <List.EmptyView
        title={emptyTitle}
        icon={emptyTitle ? undefined : null}
        description={emptyDescription}
        actions={viewActions}
      />
      {people.map((person) => {
        const name = personName(person);
        const email = isFullEmail
          ? (person.emails?.find((email) => email.toLowerCase() === query.toLowerCase()) ?? person.emails?.[0] ?? query)
          : person.emails?.[0];
        return (
          <List.Item
            key={person.id}
            title={name}
            subtitle={email === name ? undefined : email}
            icon={avatarIcon(name, avatarImages.get(person.id))}
            actions={
              webex && (
                <ActionPanel>
                  {email && <Action.Open title="Open Chat" target={chatLink(email)} icon={Icon.AppWindow} />}
                  <Action.Push
                    title="Send Message"
                    icon={Icon.Message}
                    target={
                      <ComposeMessage
                        webex={webex}
                        recipient={{ name, person }}
                        onSent={() => rememberPerson(person)}
                      />
                    }
                  />
                  {refreshAction}
                  <ManageConnectionAction />
                </ActionPanel>
              )
            }
          />
        );
      })}
      {error && people.length > 0 && !loadMore && (
        <List.Item title="Could Not Search Webex" subtitle={error} icon={Icon.ExclamationMark} actions={viewActions} />
      )}
      {loadMore && (
        <List.Item
          title="Load More People"
          subtitle={error}
          icon={Icon.ArrowDown}
          actions={
            <ActionPanel>
              <Action title="Load More People" icon={Icon.ArrowDown} onAction={loadMore} />
              {refreshAction}
              <ManageConnectionAction />
            </ActionPanel>
          }
        />
      )}
      {showEmailFallback && (
        <List.Item
          title={query}
          subtitle="No directory match"
          icon={initialAvatar(query)}
          actions={
            <ActionPanel>
              <Action.Open title="Open Chat" target={chatLink(query)} icon={Icon.AppWindow} />
              {refreshAction}
              <ManageConnectionAction />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}

function peopleListTitle(
  connecting: boolean,
  error: string | undefined,
  needsSearch: boolean,
  isLoading: boolean,
  noMatches: boolean,
) {
  if (connecting) return "Connecting to Webex";
  if (error) return "Could Not Search Webex";
  if (needsSearch) return "Find People in Webex";
  if (isLoading) return "Searching Webex";
  if (noMatches) return "No Matching People";
  return "";
}
