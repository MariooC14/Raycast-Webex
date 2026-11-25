import { Action, ActionPanel, Detail, environment, Form, Icon, useNavigation } from "@raycast/api";
import { ReactNode, useRef, useState } from "react";
import type { ConnectionPreview, Session } from "./auth";
import { oauthIsConfigured } from "./oauth-config";
import { personName, plainTextMarkdown } from "./presentation";
import { useWebexConnection } from "./use-webex-connection";
import { errorMessage } from "./webex";

const developerTokenGuide = "https://developer.webex.com/messaging/docs/getting-your-personal-access-token";

export function Connection({
  children,
  previewView,
}: Readonly<{
  children?: (session: Session | undefined, preview: ConnectionPreview | undefined) => ReactNode;
  previewView?: "spaces" | "people";
}>) {
  const connection = useWebexConnection(previewView);
  const { session, preview, error, isLoading } = connection;
  if (children && (session || isLoading)) return <>{children(session, preview)}</>;

  const isDeveloperSession = session?.mode === "developer";
  const email = session?.person.emails?.[0];
  const description = session ? "" : connectionPrompt();
  const heading = session ? "Connected to Webex" : "Webex Connection";
  const status = error ?? description;
  const markdown = isLoading ? "" : [`# ${heading}`, status && plainTextMarkdown(status)].filter(Boolean).join("\n\n");

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      metadata={
        session && (
          <Detail.Metadata>
            <Detail.Metadata.Label title="Account" text={personName(session.person)} />
            {email && <Detail.Metadata.Label title="Email" text={email} />}
            <Detail.Metadata.Label title="Sign-in Method" text={isDeveloperSession ? "Developer Token" : "Webex"} />
          </Detail.Metadata>
        )
      }
      actions={
        !isLoading && (
          <ActionPanel>
            {oauthIsConfigured && (!session || isDeveloperSession) && (
              <Action title="Sign in with Webex" icon={Icon.PersonCircle} onAction={connection.signIn} />
            )}
            {environment.isDevelopment && (
              <Action.Push
                title={isDeveloperSession ? "Replace Developer Token" : "Use Developer Token"}
                icon={Icon.Key}
                target={<DeveloperTokenForm onSave={connection.applySession} />}
              />
            )}
            {session?.mode === "oauth" && <Action title="Sign out" icon={Icon.Logout} onAction={connection.signOut} />}
            {environment.isDevelopment && (isDeveloperSession || error) && (
              <Action title="Remove Developer Token" icon={Icon.Trash} onAction={connection.removeToken} />
            )}
            <Action title="Reload Connection" icon={Icon.ArrowClockwise} onAction={connection.reload} />
          </ActionPanel>
        )
      }
    />
  );
}

function connectionPrompt(): string {
  if (oauthIsConfigured) return "Sign in to connect your Webex account.";
  if (environment.isDevelopment) return "Connect with a Webex developer token to test this build.";
  return "Webex sign-in has not been configured for this build.";
}

export function ManageConnectionAction() {
  return <Action.Push title="Manage Webex Connection" icon={Icon.Cog} target={<Connection />} />;
}

function DeveloperTokenForm({ onSave }: Readonly<{ onSave: (session: Session) => void }>) {
  const { pop } = useNavigation();
  const busy = useRef(false);
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  async function submit({ token }: { token: string }) {
    if (busy.current) return;
    busy.current = true;
    setIsLoading(true);
    setError(undefined);
    let session: Session;
    try {
      const { saveDeveloperToken } = await import("./auth");
      session = await saveDeveloperToken(token);
    } catch (error) {
      setError(errorMessage(error));
      return;
    } finally {
      setIsLoading(false);
      busy.current = false;
    }
    pop();
    onSave(session);
  }

  return (
    <Form
      navigationTitle="Webex Developer Token"
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Token" icon={Icon.Key} onSubmit={submit} />
          <Action.OpenInBrowser title="Get Developer Token" url={developerTokenGuide} />
        </ActionPanel>
      }
    >
      <Form.Description text="For local testing. Webex developer tokens expire after 12 hours." />
      <Form.PasswordField id="token" title="Personal Access Token" error={error} onChange={() => setError(undefined)} />
    </Form>
  );
}
