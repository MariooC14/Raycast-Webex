import { environment, LocalStorage, OAuth } from "@raycast/api";
import { fetchWithTimeout, readJson } from "./http";
import { oauthConfig, oauthIsConfigured } from "./oauth-config";
import {
  clearSavedConversations,
  forgetConversationAccount,
  getConversationAccount,
  readSavedConversations,
  rememberConversationAccount,
  SavedConversations,
} from "./saved-conversations";
import { clearSavedSpaces, readSavedSpaces } from "./saved-spaces";
import { Page, Person, SignInRequired, Space, WebexClient } from "./webex";

const developerTokenKey = "webex-developer-token";
const oauthClient = new OAuth.PKCEClient({
  redirectMethod: OAuth.RedirectMethod.Web,
  providerName: "Webex",
  providerIcon: "extension-icon.png",
});

const scopes = [
  "spark:rooms_read",
  "spark:people_read",
  "spark:messages_read",
  "spark:messages_write",
  "spark:memberships_read",
  "spark:kms",
];

type Mode = "oauth" | "developer";
export type Session = { mode: Mode; person: Person; webex: WebexClient };
export type ConnectionPreview = { account?: Person; spaces?: Page<Space> | null; conversations?: SavedConversations };

let pendingRefresh: { tokens: OAuth.TokenSet; result: Promise<string> } | undefined;

function readTokenResponse(response: unknown): OAuth.TokenResponse {
  const token = response as OAuth.TokenResponse | null;
  if (
    typeof token?.access_token !== "string" ||
    !token.access_token ||
    typeof token.expires_in !== "number" ||
    !Number.isFinite(token.expires_in) ||
    token.expires_in <= 0 ||
    (token.refresh_token !== undefined && typeof token.refresh_token !== "string")
  ) {
    throw new Error("Webex returned an incomplete sign-in response.");
  }
  return token;
}

function isSameTokenSet(left: OAuth.TokenSet, right?: OAuth.TokenSet): boolean {
  return left.accessToken === right?.accessToken && left.refreshToken === right.refreshToken;
}

async function refreshTokenSet(tokens: OAuth.TokenSet): Promise<string> {
  if (!tokens.refreshToken) {
    await oauthClient.removeTokens();
    throw new SignInRequired();
  }

  const { status, ok, body } = await requestTokens(oauthConfig.refreshTokenUrl || oauthConfig.tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });

  const current = await oauthClient.getTokens();
  if (!current) throw new SignInRequired();
  if (!isSameTokenSet(tokens, current)) {
    if (current.isExpired()) throw new SignInRequired();
    return current.accessToken;
  }

  if (!ok) {
    const error = body as { error?: string } | undefined;
    if (error?.error === "invalid_grant" || status === 401) {
      await oauthClient.removeTokens();
      throw new SignInRequired();
    }
    throw new Error("Webex could not refresh your sign-in. Try again shortly.");
  }

  const refreshed = readTokenResponse(body);
  await oauthClient.setTokens({ ...refreshed, refresh_token: refreshed.refresh_token ?? tokens.refreshToken });
  return refreshed.access_token;
}

function requestTokens(url: string, parameters: Record<string, string>) {
  return fetchWithTimeout(
    url,
    { method: "POST", body: new URLSearchParams({ client_id: oauthConfig.clientId, ...parameters }) },
    async (response, signal) => ({ status: response.status, ok: response.ok, body: await readJson(response, signal) }),
    {
      timeout: "Webex sign-in took too long to respond. Try again.",
      connection: "Could not reach Webex sign-in. Check your connection and try again.",
    },
  );
}

async function readDeveloperToken(): Promise<string | undefined> {
  if (environment.isDevelopment) return LocalStorage.getItem<string>(developerTokenKey);
}

async function getAccessToken(mode: Mode): Promise<string> {
  const developerToken = await readDeveloperToken();
  if (mode === "developer") {
    if (!developerToken) throw new SignInRequired("Replace your developer token using Manage Webex Connection.");
    return developerToken;
  }

  if (developerToken) throw new SignInRequired("The Webex sign-in method changed. Reopen this command.");
  if (!oauthIsConfigured) throw new SignInRequired();
  const tokens = await oauthClient.getTokens();
  if (!tokens) throw new SignInRequired();
  if (!tokens.isExpired()) return tokens.accessToken;

  if (pendingRefresh && isSameTokenSet(tokens, pendingRefresh.tokens)) return pendingRefresh.result;

  const result = refreshTokenSet(tokens).finally(() => {
    if (pendingRefresh?.result === result) pendingRefresh = undefined;
  });
  pendingRefresh = { tokens, result };
  return result;
}

async function verifyAccount(token: string, mode: Mode, signal?: AbortSignal): Promise<Person> {
  try {
    return await new WebexClient(async () => token).getMe(signal);
  } catch (error) {
    if (error instanceof SignInRequired && mode === "developer") {
      throw new SignInRequired("The developer token is invalid or has expired. Enter a new token.");
    }
    throw error;
  }
}

async function createSession(mode: Mode, token: string, signal?: AbortSignal): Promise<Session> {
  const person = await verifyAccount(token, mode, signal);
  signal?.throwIfAborted();
  await rememberConversationAccount(person, token);
  let verifiedToken = token;
  const webex = new WebexClient(async (signal) => {
    const currentToken = await getAccessToken(mode);
    if (currentToken !== verifiedToken) {
      const currentPerson = await verifyAccount(currentToken, mode, signal);
      if (currentPerson.id !== person.id) {
        throw new SignInRequired("The Webex account changed. Reopen this command to use the new account.");
      }
      verifiedToken = currentToken;
      await rememberConversationAccount(currentPerson, currentToken);
    }
    return currentToken;
  }, person.id);
  return { mode, person, webex };
}

export async function restoreSession(
  previewView?: "spaces" | "people",
  showPreview?: (preview: ConnectionPreview) => void,
  signal?: AbortSignal,
): Promise<Session | undefined> {
  const developerToken = await readDeveloperToken();
  if (!developerToken && (!oauthIsConfigured || !(await oauthClient.getTokens()))) return;

  const mode = developerToken ? "developer" : "oauth";
  let token = developerToken;

  try {
    token ??= await getAccessToken(mode);

    if (previewView && showPreview) {
      const [spaces, account] = await Promise.all([
        previewView === "spaces" ? readSavedSpaces(token) : undefined,
        getConversationAccount(token),
      ]);
      const conversations = account ? await readSavedConversations(account.id) : undefined;
      signal?.throwIfAborted();
      showPreview({ account, spaces: previewView === "spaces" ? (spaces?.page ?? null) : undefined, conversations });
    }

    return await createSession(mode, token, signal);
  } catch (error) {
    if (error instanceof SignInRequired) {
      await Promise.all([clearSavedSpaces(), forgetConversationAccount(token)]);
    }
    throw error;
  }
}

export async function signInWithWebex(): Promise<Session> {
  if (!oauthIsConfigured) throw new Error("Webex sign-in has not been configured for this build.");

  let request: OAuth.AuthorizationRequest;
  let code: string;
  try {
    request = await oauthClient.authorizationRequest({
      endpoint: oauthConfig.authorizeUrl,
      clientId: oauthConfig.clientId,
      scope: scopes.join(" "),
    });
    ({ authorizationCode: code } = await oauthClient.authorize(request));
  } catch {
    throw new Error("Webex sign-in did not finish. Try again or check your organization's integration access.");
  }

  const { ok, body } = await requestTokens(oauthConfig.tokenUrl, {
    grant_type: "authorization_code",
    code,
    code_verifier: request.codeVerifier,
    redirect_uri: request.redirectURI,
  });
  if (!ok)
    throw new Error("Webex could not complete sign-in. Try again or check your organization's integration access.");
  const tokens = readTokenResponse(body);
  const session = await createSession("oauth", tokens.access_token);
  await oauthClient.setTokens(tokens);
  await clearSavedSpaces();
  if (environment.isDevelopment) await LocalStorage.removeItem(developerTokenKey);
  return session;
}

export async function saveDeveloperToken(value: string): Promise<Session> {
  if (!environment.isDevelopment) throw new Error("Developer tokens are only available in development mode.");
  const token = value.trim().replace(/^Bearer\s+/i, "");
  if (!token || /\s/.test(token)) throw new Error("Enter a personal access token from Webex for Developers.");
  const session = await createSession("developer", token);
  await clearSavedSpaces();
  await LocalStorage.setItem(developerTokenKey, token);
  return session;
}

export async function removeDeveloperToken() {
  if (environment.isDevelopment) {
    await LocalStorage.removeItem(developerTokenKey);
    await Promise.all([clearSavedSpaces(), clearSavedConversations()]);
  }
}

export async function signOutOfWebex() {
  await oauthClient.removeTokens();
  await Promise.all([clearSavedSpaces(), clearSavedConversations()]);
}
