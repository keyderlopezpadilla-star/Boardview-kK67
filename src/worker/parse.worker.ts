/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from '../core/types';
import { loadFiles } from './pipeline';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, files, keys, pick } = ev.data;
  let res: WorkerResponse;
  try {
    res = { id, ...loadFiles(files, keys, pick) } as WorkerResponse;
  } catch (e) {
    res = { id, type: 'error', message: (e as Error).message || String(e) };
  }
  const transfer = res.type === 'board' ? [...new Set(res.attachments.map((a) => a.data.buffer as ArrayBuffer))] : [];
  ctx.postMessage(res, transfer);
};
