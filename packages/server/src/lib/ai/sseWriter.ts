// Phase 135-10: SSE event writer. The route sets headers; this only frames events and never throws on a closed socket.
import type { Response } from "express";

export function createSseWriter(res: Response): { send(event: string, data: unknown): void; comment(text: string): void; readonly closed: boolean } {
  const isClosed = (): boolean => res.writableEnded || res.destroyed;
  const safeWrite = (chunk: string): void => {
    if (isClosed()) return;
    try {
      res.write(chunk);
    } catch {
      /* socket gone mid-write: nothing to do */
    }
  };
  return {
    send(event, data) {
      safeWrite(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    comment(text) {
      safeWrite(`: ${text}\n\n`);
    },
    get closed() {
      return isClosed();
    },
  };
}
