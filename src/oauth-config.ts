import { environment } from "@raycast/api";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type OAuthConfig = {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  refreshTokenUrl?: string;
};

const releaseConfig: OAuthConfig = {
  clientId: "C2c0dec60987240d2ee98ee31877eca1f5c0735b1f0eea0a1f5e0b78db3fbf83a",
  authorizeUrl:
    "https://oauth.raycast.com/v1/authorize/2.IQdVsl_0SFy5WZjIX3x0P9kLTDRCYnx6v9HuKy05tq6mwiQIcdYt_CChlHpl25If4mGkQ97z0VYMQczLw68EFfG1thdeVrxMGabcoKLR40ObksSnsKyk2yHVnLrdBwHslQdcBEZJ3GcsK6tlL0-UVMA_Vx5dxz3YMvrPQTS8o8Ohpa8FGliLajrDpnc",
  tokenUrl:
    "https://oauth.raycast.com/v1/token/2.yiz0sKkypTCodrEuv_lmiAB7Ai0GKHlmP5VfYzMUjGS4yo1hdVTw1k4QnDKdaVRfDtNqOzK_xwU2HJBVovbyx6j4kVw2WOmRNGIsK1uIHJUdX6hlsL7CYpbkhPZ8UdU40OYpl6el8od_Bo8sZ0Cdj0OsgCxTH6iX_eMjxwn820uzbU83vE28aOrh725v_18",
};

export const localOAuthConfigPath = environment.isDevelopment
  ? join(environment.supportPath, "oauth-config.json")
  : undefined;

function isProxyUrl(value: unknown): value is string {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.origin === "https://oauth.raycast.com" && !url.username && !url.password && !url.hash;
}

function isOAuthConfig(value: unknown): value is OAuthConfig {
  if (!value || typeof value !== "object") return false;
  const { clientId, authorizeUrl, tokenUrl, refreshTokenUrl } = value as Partial<OAuthConfig>;
  return (
    typeof clientId === "string" &&
    clientId.length > 0 &&
    !/\s/.test(clientId) &&
    isProxyUrl(authorizeUrl) &&
    isProxyUrl(tokenUrl) &&
    (refreshTokenUrl === undefined || refreshTokenUrl === "" || isProxyUrl(refreshTokenUrl))
  );
}

function readLocalConfig(path: string | undefined): { config?: OAuthConfig; error?: string } {
  if (!path) return {};
  try {
    const config: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (isOAuthConfig(config)) return { config };
    return { error: "Set the Webex client ID and the generated Raycast proxy URLs in oauth-config.json." };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    return { error: "Could not read oauth-config.json. Check that it is readable and contains valid JSON." };
  }
}

const localConfig = readLocalConfig(localOAuthConfigPath);
export const oauthConfig = localConfig.config ?? releaseConfig;
export const oauthConfigError = localConfig.error;
export const oauthIsConfigured = !oauthConfigError && isOAuthConfig(oauthConfig);
