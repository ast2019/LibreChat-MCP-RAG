import { useEffect, useRef, useState } from 'react';
import { SSE } from 'sse.js';
import { apiBaseUrl } from 'librechat-data-provider';
import type { TBrowserFrame, TBrowserSessionView } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 5_000;

export type BrowserLiveState = Pick<TBrowserSessionView, 'control' | 'handoff' | 'url' | 'title'>;

/** Whether the page is on screen: a hidden tab stops the stream, which saves the user's data. */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/**
 * The live view of one browser: its newest frame, and who has it, from the browser's event
 * stream. Connects while `enabled` and the page is visible, reconnects with backoff, and stops
 * for good when the browser closes.
 */
export default function useBrowserLiveView(
  sessionId: string | null | undefined,
  enabled: boolean,
  {
    onState,
    onClosed,
  }: { onState?: (state: BrowserLiveState) => void; onClosed?: () => void } = {},
): { frame: TBrowserFrame | null; connected: boolean } {
  const { token, isAuthenticated } = useAuthContext();
  const visible = useDocumentVisible();
  const [frame, setFrame] = useState<TBrowserFrame | null>(null);
  const [connected, setConnected] = useState(false);
  const onStateRef = useRef(onState);
  const onClosedRef = useRef(onClosed);
  onStateRef.current = onState;
  onClosedRef.current = onClosed;

  useEffect(() => {
    setFrame(null);
  }, [sessionId]);

  useEffect(() => {
    if (!enabled || !visible || sessionId == null || !isAuthenticated || token == null) {
      return;
    }
    const endpoint = `${apiBaseUrl()}/api/browser/sessions/${encodeURIComponent(sessionId)}/view`;
    let stream: SSE | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;
    let closed = false;

    const connect = () => {
      retryTimer = undefined;
      if (disposed || closed) {
        return;
      }
      const next = new SSE(endpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      stream = next;
      next.addEventListener('open', () => {
        if (stream === next) {
          setConnected(true);
        }
      });
      next.addEventListener('frame', (event: MessageEvent) => {
        if (stream !== next || disposed) {
          return;
        }
        try {
          setFrame(JSON.parse(event.data) as TBrowserFrame);
          attempt = 0;
        } catch {
          /* a partial frame; the next one replaces it */
        }
      });
      next.addEventListener('state', (event: MessageEvent) => {
        if (stream !== next || disposed) {
          return;
        }
        try {
          onStateRef.current?.(JSON.parse(event.data) as BrowserLiveState);
        } catch {
          /* ignored */
        }
      });
      next.addEventListener('closed', () => {
        closed = true;
        next.close();
        setConnected(false);
        onClosedRef.current?.();
      });
      next.addEventListener('error', () => {
        if (stream !== next) {
          return;
        }
        setConnected(false);
        next.close();
        if (disposed || closed) {
          return;
        }
        const delay = Math.min(RETRY_MIN_MS * 2 ** attempt, RETRY_MAX_MS);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      stream?.close();
      stream = undefined;
      setConnected(false);
    };
  }, [enabled, visible, sessionId, isAuthenticated, token]);

  return { frame, connected };
}
