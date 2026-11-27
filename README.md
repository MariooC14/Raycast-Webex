# Messages for Webex

A Raycast extension for macOS. Browse direct and group spaces, read recent messages, and send plain-text messages from Raycast. Find people by name or email and open a conversation in the Webex desktop app.

## Run locally

Install Raycast and Node.js 24 or newer, then run these commands from the project directory. [Download Raycast](https://www.raycast.com/)

```sh
npm ci
npm run dev
```

Open **Manage Webex Connection** and choose **Sign in with Webex** once browser sign-in is configured. Then open **Browse Spaces** or **Find People**.

For local API testing, you can also choose **Use Developer Token** and enter a token from the Webex developer portal in Raycast's masked field. [Get a Webex developer token](https://developer.webex.com/messaging/docs/getting-your-personal-access-token)

Developer tokens expire 12 hours after signing in to the portal. Use **Replace Developer Token** to enter a fresh token or **Remove Developer Token** to clear it. The token is stored in Raycast's encrypted local storage. These actions are available in development builds. [Raycast data storage](https://developers.raycast.com/information/security#data-storage)

## Cached results and avatars

Browse Spaces shows the last saved first page for your current sign-in while Webex checks the connection. Raycast can show that page for up to 24 hours and refreshes it after one minute. It also saves joined spaces from every page it loads, so those spaces can match a title search after reopening the command. Use **Refresh Results** in the Actions menu to fetch the latest first page. While filtering, **Load More Spaces** is available from the Actions menu.

Find People searches saved direct contacts by name and email as you type, then combines them with Webex directory results. It saves people you message from the extension and, while the command is open, checks recent messages in existing direct conversations for others you have messaged. Other directory results stay in memory for up to two minutes. Use **Refresh Results** in the Actions menu to run the current search against Webex again. Saved contacts and spaces are scoped to your Webex account in Raycast's encrypted storage. Message text and downloaded avatars stay in memory.

Webex restricts directory name search for Consumer accounts. You can still search saved contacts by name or enter an exact email address. When there is no directory match for an email address, **Open Chat** opens it in the Webex app. [Webex People API](https://developer.webex.com/messaging/docs/api/v1/people/list-people)

Find People and direct chats in Browse Spaces show Webex profile photos when available. Group spaces and rows without a photo use a gray circle with the first letter of their name. The public Rooms API does not document a field for a custom group-space image. [Webex Rooms API](https://developer.webex.com/messaging/docs/api/v1/rooms)

Recent messages are cached for 30 seconds and older message pages for five minutes. Use **Reload Messages** to fetch fresh results.

## Configure browser sign-in

Maintainers configure one Webex Integration for the extension. Once configured, users choose **Sign in with Webex** and complete sign-in in their browser. The extension uses Raycast's hosted proxy for token exchange and refresh, and calls Webex directly for messaging. [Webex authentication](https://developer.webex.com/messaging/docs/authentication) · [Raycast OAuth](https://developers.raycast.com/api-reference/oauth)

1. Open **My Webex Apps** and choose **Create a New App → Create an Integration**. Enter a name, description, and icon. Register the proxy callback exactly as `https://oauth.raycast.com/redirect`. The proxy passes this callback to Webex and returns the browser to Raycast afterward. [Webex Integration registration](https://developer.webex.com/create/docs/integrations) · [Raycast proxy setup example](https://www.raycast.com/maujogue/42-api)
2. Enable the permissions below. Webex adds `spark:kms` to the Integration. The extension includes it in its authorization request.
3. Enter the Integration's client ID and secret in the Raycast PKCE proxy. Use `https://webexapis.com/v1/authorize` for authorization and `https://webexapis.com/v1/access_token` for token exchange. Leave the upstream refresh URL blank because Webex uses the same endpoint for both operations. Select **form** encoding. [Raycast PKCE proxy](https://oauth.raycast.com/)
4. In the development extension, open **Manage Webex Connection** and choose **Copy Local OAuth Settings Path** from the Actions menu. Create the directory if needed and save the following JSON at that path. Fill in the Webex client ID and the **generated** Raycast URLs. Omit `refreshTokenUrl` if the proxy supplies one URL for both token operations. Keep the raw client secret in the registration and proxy setup.

   ```json
   {
     "clientId": "WEBEX_CLIENT_ID",
     "authorizeUrl": "GENERATED_RAYCAST_AUTHORIZE_URL",
     "tokenUrl": "GENERATED_RAYCAST_TOKEN_URL",
     "refreshTokenUrl": "GENERATED_RAYCAST_REFRESH_URL"
   }
   ```

5. Restart `npm run dev`, reopen **Manage Webex Connection**, and choose **Sign in with Webex**. Successful browser sign-in replaces the developer token for this installation.

| Scope                    | Used for                                          |
| ------------------------ | ------------------------------------------------- |
| `spark:rooms_read`       | List the user's spaces                            |
| `spark:people_read`      | Identify the signed-in account and look up people |
| `spark:messages_read`    | Read messages in a space                          |
| `spark:messages_write`   | Send messages to a space or person                |
| `spark:memberships_read` | Identify the other person in a direct space       |
| `spark:kms`              | Access encrypted message content                  |

[Webex integration scopes](https://developer.webex.com/create/docs/integration-scopes)

Webex's message write scope also permits deletion. The extension uses it to send messages after the user submits the compose form. The Integration receives a separate grant for each user, limited to that user's Webex access and organization policy. [Webex integration scopes](https://developer.webex.com/create/docs/integration-scopes) · [Webex authentication](https://developer.webex.com/messaging/docs/authentication)

If you already configured an Integration, add `spark:memberships_read` and sign in again to grant the permission.

## Troubleshooting

- If Webex reports `redirect_uri_mismatch`, check that the Integration's registered redirects include `https://oauth.raycast.com/redirect` with no trailing slash or query string. Raycast uses `https://raycast.com/redirect?packageName=Extension` to return to the extension, and the proxy supplies its own callback to Webex. [Webex OAuth requirements](https://developer.webex.com/messaging/docs/authentication)
- If Webex denies access, check the registered scopes. For managed accounts, ask the organization's Webex admin to check the Integration's access in Control Hub. Directory and messaging permissions still apply after sign-in. [Control Hub integration access](https://help.webex.com/article/igy96e/Configure-User-Access-to-Integrations-in-Cisco-Webex-Control-Hub)
- To reconnect or switch accounts, use **Manage Webex Connection**. **Sign out** clears the OAuth tokens stored by Raycast, along with saved contacts and spaces. Manage the Webex grant from your Webex account. [Webex authorization management](https://developer.webex.com/admin/docs/api/v1/authorizations)
- The desktop actions require Webex to handle `webexteams:` links. If Webex reports an uncertain send, check the conversation before sending the draft again. [Webex desktop links](https://help.webex.com/article/n5yzg8y/add-links-for-cisco-webex-teams-meetings-or-spaces-with-webex-protocol)

## Release checks

`releaseConfig` in `src/oauth-config.ts` holds the release Integration's client ID and generated proxy URLs. Development builds use the local `oauth-config.json` when it exists and otherwise sign in through the release Integration.

Run `npm run build` and `npm run lint`. In Raycast, verify that you can load more spaces and older messages, open a space or chat in Webex, and send to both a test space and a test contact. Exercise a name and exact-email lookup, an expired developer token, a denied request, and a rate-limited request. Check that a rejected or uncertain send keeps the draft.

Reopen Find People and search for part of the name of someone you have messaged. Confirm the saved match appears while Webex searches. Check that a directory-only match disappears from the cache after closing the command, and that a previously loaded space can still match a title search after reopening Browse Spaces.

Before distributing, verify browser sign-in, refresh, and logout with a Cisco employee account and an account outside Cisco. Check whether the Integration needs an organization allowlist or Webex App Hub review. [Webex App Hub submission](https://developer.webex.com/create/docs/app-hub-submission-process)
