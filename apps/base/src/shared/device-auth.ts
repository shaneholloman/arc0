/**
 * Device Authorization Grant (OAuth 2.0 Device Code Flow)
 *
 * Based on packages/client/src/auth/index.ts implementation.
 */

import pc from "picocolors";
import open from "open";

const AUTH_API_URL = "https://api.arc0.ai/api/auth";

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  user?: {
    id: string;
    email: string;
    name?: string;
  };
}

export interface ErrorResponse {
  error: string;
  message?: string;
}

export interface UserInfo {
  id: string;
  email?: string;
  name?: string;
}

/**
 * Request a device code from the auth server.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(`${AUTH_API_URL}/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: "arc0-cli" }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMsg: string;
    try {
      const error = JSON.parse(errorText) as ErrorResponse;
      errorMsg = error.message || error.error || errorText;
    } catch {
      errorMsg = errorText;
    }
    throw new Error(`Failed to get device code: ${errorMsg}`);
  }

  return response.json();
}

/**
 * Poll for token after user approves.
 */
export async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<TokenResponse | null> {
  const startTime = Date.now();
  const expiresAt = startTime + expiresIn * 1000;

  while (Date.now() < expiresAt) {
    await sleep(interval * 1000);

    try {
      const response = await fetch(`${AUTH_API_URL}/device/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: "arc0-cli",
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      if (response.ok) {
        return (await response.json()) as TokenResponse;
      }

      const error = (await response.json()) as ErrorResponse;

      if (error.error === "authorization_pending") {
        continue;
      }

      if (error.error === "slow_down") {
        interval += 5;
        continue;
      }

      if (error.error === "expired_token" || error.error === "access_denied") {
        return null;
      }
    } catch {
      // Network error, keep trying
      continue;
    }
  }

  return null;
}

/**
 * Validate a token and get user info.
 */
export async function validateToken(token: string): Promise<UserInfo | null> {
  try {
    const response = await fetch(`${AUTH_API_URL}/get-session`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { user?: UserInfo };
    return data.user || null;
  } catch {
    return null;
  }
}

/**
 * Display device code and open browser.
 */
export function displayDeviceCode(codeResponse: DeviceCodeResponse): void {
  const code = codeResponse.user_code.toUpperCase();
  const formattedCode = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
  const deviceUrl = codeResponse.verification_uri;

  console.log("");
  console.log(pc.bold("  Device Authorization"));
  console.log("");
  console.log(pc.dim("  Enter this code in your browser:"));
  console.log("");
  console.log(pc.cyan(pc.bold(`    ${formattedCode}`)));
  console.log("");
  console.log(pc.dim(`  Opening: ${deviceUrl}`));
  console.log("");

  // Auto-open browser
  open(deviceUrl).catch(() => {
    // Ignore errors from opening browser
  });
}

/**
 * Full device auth flow - request code, display to user, poll for token.
 * Returns token and user info on success.
 */
export async function performDeviceAuth(
  onStatus?: (status: "requesting" | "waiting" | "success" | "failed", message?: string) => void
): Promise<{ token: string; user: UserInfo }> {
  const log = onStatus || (() => {});

  // Request device code
  log("requesting");
  const codeResponse = await requestDeviceCode();

  // Display to user and open browser
  displayDeviceCode(codeResponse);

  // Poll for token
  log("waiting");
  const tokenResponse = await pollForToken(
    codeResponse.device_code,
    codeResponse.interval,
    codeResponse.expires_in
  );

  if (!tokenResponse) {
    log("failed", "Authorization timed out or was denied");
    throw new Error("Authorization timed out or was denied");
  }

  // Get user info from session endpoint (token response may not include it)
  const user = await validateToken(tokenResponse.access_token);
  if (!user) {
    log("failed", "Failed to get user info");
    throw new Error("Failed to get user info from token");
  }

  log("success", user.email || user.id);

  return { token: tokenResponse.access_token, user };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
