import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { HttpRequestError, type FileUploadHttpClient, type FileUploadHttpRequest, type HttpResponse } from '@stepsvault/sync-core';
import type { GetSourceFilePath } from './node-multipart-http-client';
import { fetchWithLimits, getUserAgentHeader } from './node-http-client';

/**
 * Sends one file as the whole body, streamed from disk. Files are only ever found by sourceId, so nothing outside the
 * app's known files can be sent.
 */
export class NodeFileUploadHttpClient implements FileUploadHttpClient {
  private readonly appVersion: string;
  private readonly getSourceFilePath: GetSourceFilePath;

  constructor({ appVersion, getSourceFilePath }: { appVersion: string; getSourceFilePath: GetSourceFilePath }) {
    this.appVersion = appVersion;
    this.getSourceFilePath = getSourceFilePath;
  }

  async requestTextWithFileBody(request: FileUploadHttpRequest): Promise<HttpResponse<string>> {
    const filePath = this.getSourceFilePath(request.sourceId);
    const fileStats = filePath === null ? null : await stat(filePath).catch(() => null);
    if (filePath === null || !fileStats?.isFile()) throw new HttpRequestError({ failure: 'network', message: 'The file to send is gone. Try again.' });
    const headers = { ...getUserAgentHeader(this.appVersion), ...request.headers, 'Content-Type': request.contentType, 'Content-Length': String(fileStats.size) };
    // Node's fetch streams an async iterable body only in half-duplex mode; the DOM types know neither.
    const init = { method: request.method, headers, body: streamFile(filePath), duplex: 'half' } as unknown as RequestInit;
    const { status, bytes } = await fetchWithLimits({ url: request.url, init, timeoutMilliseconds: request.timeoutMilliseconds, maxResponseBytes: request.maxResponseBytes });
    return { status, body: new TextDecoder().decode(bytes) };
  }
}

async function* streamFile(filePath: string): AsyncGenerator<Uint8Array> {
  for await (const chunk of createReadStream(filePath)) yield chunk as Uint8Array;
}
