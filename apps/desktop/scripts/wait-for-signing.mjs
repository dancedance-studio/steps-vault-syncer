// Waits while the owner approves a SignPath signing request by hand, then downloads the signed artifact (a zip). The
// signpath/github-action-submit-signing-request step submits it without waiting, so #admins hears about it at once;
// this uses the same SignPath connector routes the action itself waits and downloads with.
// Usage: SIGNPATH_API_TOKEN=… SIGNPATH_ORGANIZATION_ID=… SIGNING_REQUEST_ID=… node wait-for-signing.mjs <zip to write>
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

/** The action's default connector (its input connector-url). */
export const SIGNPATH_CONNECTOR_URL = 'https://pipelineconnector.connectors.signpath.io/GitHubActions/GitHubCom';
const CHECK_EVERY_MILLISECONDS = 30_000;
/** A GitHub-hosted job stops after 6 hours; this leaves time to download and hand the files on. */
export const DEFAULT_WAIT_MINUTES = 330;
const REQUEST_TIMEOUT_MILLISECONDS = 60_000;
const DOWNLOAD_TIMEOUT_MILLISECONDS = 10 * 60_000;

export function buildSigningRequestUrls({ connectorUrl = SIGNPATH_CONNECTOR_URL, organizationId, signingRequestId }) {
  const signingRequestUrl = `${connectorUrl.replace(/\/$/, '')}/${encodeURIComponent(organizationId)}/SigningRequests/${encodeURIComponent(signingRequestId)}`;
  return { statusUrl: `${signingRequestUrl}/Status?api-version=1.0`, signedArtifactUrl: `${signingRequestUrl}/SignedArtifact?api-version=1.0` };
}

/**
 * Asks for the request's status until it is final. A status call that fails (SignPath busy, the network) is tried
 * again at the next check; only a final status other than Completed, or the end of the wait, is a failure.
 */
export async function waitForSigningRequest({ fetchStatus, waitMilliseconds, getNowMilliseconds, timeoutMilliseconds, log }) {
  const giveUpAt = getNowMilliseconds() + timeoutMilliseconds;
  let lastStatus = 'unknown';
  for (;;) {
    try {
      const status = await fetchStatus();
      if (status.isFinalStatus === true) {
        if (status.status !== 'Completed') throw new SigningRefusedError(`The signing request ended as ${String(status.status)}, so nothing was signed.`);
        return;
      }
      if (String(status.status) !== lastStatus) log(`Signing request: ${String(status.status)}. Waiting for the approval on SignPath…`);
      lastStatus = String(status.status);
    } catch (error) {
      if (error instanceof SigningRefusedError) throw error;
      log(`SignPath didn't answer (${error instanceof Error ? error.message : String(error)}); asking again.`);
    }
    if (getNowMilliseconds() + CHECK_EVERY_MILLISECONDS > giveUpAt) throw new Error(`The signing request was still ${lastStatus} when the wait ended. Approve it sooner, or run this job again (docs/releasing.md).`);
    await waitMilliseconds(CHECK_EVERY_MILLISECONDS);
  }
}

class SigningRefusedError extends Error {}

async function fetchWithToken({ url, token, timeoutMilliseconds }) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'dancedance-studio-sync-release' }, signal: AbortSignal.timeout(timeoutMilliseconds) });
  if (!response.ok) throw new Error(`SignPath answered ${String(response.status)}`);
  return response;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const zipPath = process.argv[2];
  const { SIGNPATH_API_TOKEN: token, SIGNPATH_ORGANIZATION_ID: organizationId, SIGNING_REQUEST_ID: signingRequestId } = process.env;
  if (!zipPath || !token || !organizationId || !signingRequestId) throw new Error('Give the zip to write, and set SIGNPATH_API_TOKEN, SIGNPATH_ORGANIZATION_ID and SIGNING_REQUEST_ID.');
  const { statusUrl, signedArtifactUrl } = buildSigningRequestUrls({ connectorUrl: process.env.SIGNPATH_CONNECTOR_URL || undefined, organizationId, signingRequestId });
  await waitForSigningRequest({
    fetchStatus: async () => (await fetchWithToken({ url: statusUrl, token, timeoutMilliseconds: REQUEST_TIMEOUT_MILLISECONDS })).json(),
    waitMilliseconds: (milliseconds) => delay(milliseconds),
    getNowMilliseconds: () => Date.now(),
    timeoutMilliseconds: Number(process.env.WAIT_MINUTES || DEFAULT_WAIT_MINUTES) * 60_000,
    log: (line) => { console.log(line); },
  });
  const signedArtifact = await fetchWithToken({ url: signedArtifactUrl, token, timeoutMilliseconds: DOWNLOAD_TIMEOUT_MILLISECONDS });
  await writeFile(zipPath, new Uint8Array(await signedArtifact.arrayBuffer()));
  console.log(`Signed. The signed artifact is in ${zipPath}.`);
}
