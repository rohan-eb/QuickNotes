import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as vscode from 'vscode';

const GOOGLE_AUTH_BASE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
].join(' ');
const DEFAULT_GOOGLE_OAUTH_CLIENT_ID = '239516842795-0lgomvg6usceul47udntui1im5t46v7g.apps.googleusercontent.com';

function toBase64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createPkceVerifier(): string {
  return toBase64Url(crypto.randomBytes(64));
}

function createPkceChallenge(verifier: string): string {
  return toBase64Url(crypto.createHash('sha256').update(verifier).digest());
}

function getOAuthClientId(): string {
  const configured = vscode.workspace.getConfiguration().get<string>('devnotes.googleDriveOAuthClientId', '').trim();
  return configured || DEFAULT_GOOGLE_OAUTH_CLIENT_ID;
}

function getOAuthRedirectUri(): string {
  return vscode.workspace
    .getConfiguration()
    .get<string>('devnotes.googleDriveOAuthRedirectUri', 'http://127.0.0.1:53682/oauth2callback')
    .trim();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function exchangeAuthCodeForToken(
  clientId: string,
  redirectUri: string,
  code: string,
  verifier: string
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const data = (await response.json()) as TokenResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Google token exchange failed.');
  }
  return data;
}

async function refreshAccessToken(clientId: string, refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const data = (await response.json()) as TokenResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || 'Google token refresh failed.');
  }
  return data;
}

async function waitForAuthorizationCode(redirectUri: string, timeoutMs = 180_000): Promise<string> {
  const redirectUrl = new URL(redirectUri);
  const port = Number(redirectUrl.port || '80');
  const pathname = redirectUrl.pathname || '/';

  return new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
        if (requestUrl.pathname !== pathname) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        const error = requestUrl.searchParams.get('error');
        const code = requestUrl.searchParams.get('code');

        if (error) {
          res.statusCode = 400;
          res.end('QuickNotes Google sign-in failed. You can close this tab.');
          reject(new Error(`Google authorization failed: ${error}.`));
          return;
        }

        if (!code) {
          res.statusCode = 400;
          res.end('Missing authorization code. You can close this tab.');
          reject(new Error('Google authorization code was not provided.'));
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<html><body><h3>QuickNotes connected successfully.</h3><p>You can close this window.</p></body></html>');
        resolve(code);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        server.close();
      }
    });

    server.listen(port, '127.0.0.1', () => {
      const timer = setTimeout(() => {
        server.close();
        reject(new Error('Google authorization timed out.'));
      }, timeoutMs);

      server.once('close', () => clearTimeout(timer));
    });

    server.on('error', (error) => {
      reject(new Error(`Unable to start OAuth callback listener: ${error.message}`));
    });
  });
}

export async function connectGoogleDriveOAuth(): Promise<void> {
  const clientId = getOAuthClientId();
  const redirectUri = getOAuthRedirectUri();
  if (!clientId) {
    throw new Error('Google Drive sign-in is unavailable in this build. Missing OAuth client configuration.');
  }

  const verifier = createPkceVerifier();
  const challenge = createPkceChallenge(verifier);
  const state = toBase64Url(crypto.randomBytes(16));
  const authUrl = new URL(GOOGLE_AUTH_BASE_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GOOGLE_SCOPES);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  const waitForCode = waitForAuthorizationCode(redirectUri);
  await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));
  const code = await waitForCode;

  const token = await exchangeAuthCodeForToken(clientId, redirectUri, code, verifier);
  const expiresAt = token.expires_in ? Date.now() + token.expires_in * 1000 : 0;
  const config = vscode.workspace.getConfiguration();
  await config.update('devnotes.googleDriveAccessToken', token.access_token || '', vscode.ConfigurationTarget.Global);
  if (token.refresh_token) {
    await config.update('devnotes.googleDriveRefreshToken', token.refresh_token, vscode.ConfigurationTarget.Global);
  }
  await config.update('devnotes.googleDriveTokenExpiry', expiresAt, vscode.ConfigurationTarget.Global);
  await config.update('devnotes.syncProvider', 'googleDrive', vscode.ConfigurationTarget.Global);
  await config.update('devnotes.activeAccountKey', 'google-drive-default', vscode.ConfigurationTarget.Global);
  await config.update('devnotes.activeAccountLabel', 'Google Drive', vscode.ConfigurationTarget.Global);
  await config.update('devnotes.localOnlyMode', false, vscode.ConfigurationTarget.Global);
  await config.update('devnotes.autoSync', true, vscode.ConfigurationTarget.Global);
}

export async function getValidGoogleDriveAccessToken(): Promise<string> {
  const config = vscode.workspace.getConfiguration();
  const accessToken = config.get<string>('devnotes.googleDriveAccessToken', '').trim();
  const refreshToken = config.get<string>('devnotes.googleDriveRefreshToken', '').trim();
  const expiresAt = Number(config.get<number>('devnotes.googleDriveTokenExpiry', 0));
  const clientId = getOAuthClientId();

  if (accessToken && expiresAt > Date.now() + 60_000) {
    return accessToken;
  }

  if (!refreshToken) {
    return accessToken;
  }

  if (!clientId) {
    throw new Error('Google Drive token refresh is unavailable in this build. Missing OAuth client configuration.');
  }

  const refreshed = await refreshAccessToken(clientId, refreshToken);
  const nextToken = refreshed.access_token || '';
  const nextExpiry = refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : 0;
  await config.update('devnotes.googleDriveAccessToken', nextToken, vscode.ConfigurationTarget.Global);
  await config.update('devnotes.googleDriveTokenExpiry', nextExpiry, vscode.ConfigurationTarget.Global);
  return nextToken;
}
