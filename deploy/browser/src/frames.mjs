const HEARTBEAT_MS = 15_000;
const TOUCH_MS = 30_000;
const STATE_MS = 1_000;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/**
 * The live view of one browser as an event stream: `frame` events (a JPEG and the viewport it
 * shows) at most `fps` a second, keeping only the newest when the viewer falls behind, and
 * `state` events whenever who has the browser, the address or the title changes. An open live
 * view counts as activity, so the browser does not close while the user is looking at it.
 * Throws before writing anything when the browser is not open, so the caller can answer 404.
 */
export function streamFrames(req, res, { manager, id, fps, quality }) {
  const handle = manager.handle(id);
  res.writeHead(200, SSE_HEADERS);
  res.flushHeaders?.();

  let pending = null;
  let waiting = false;
  let closed = false;
  let lastState = '';
  const timers = [];

  const write = (text) => {
    if (closed || waiting) {
      return;
    }
    if (!res.write(text)) {
      waiting = true;
      res.once('drain', () => {
        waiting = false;
      });
    }
  };

  const flush = () => {
    if (pending == null || waiting || closed) {
      return;
    }
    const frame = pending;
    pending = null;
    write(`event: frame\ndata: ${JSON.stringify(frame)}\n\n`);
  };

  const end = () => {
    if (closed) {
      return;
    }
    closed = true;
    for (const timer of timers) {
      clearInterval(timer);
    }
    unsubscribe();
    res.end();
  };

  const sendState = () => {
    let session;
    try {
      session = manager.get(id);
    } catch {
      write('event: closed\ndata: {}\n\n');
      end();
      return;
    }
    const state = JSON.stringify({
      control: session.control,
      handoff: session.handoff,
      url: session.url,
      title: session.title,
    });
    if (state !== lastState) {
      lastState = state;
      write(`event: state\ndata: ${state}\n\n`);
    }
  };

  const unsubscribe = handle.frames(
    (frame) => {
      pending = frame;
    },
    { quality },
  );
  sendState();
  timers.push(setInterval(flush, Math.round(1000 / fps)));
  timers.push(setInterval(sendState, STATE_MS));
  timers.push(setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS));
  timers.push(
    setInterval(() => {
      try {
        manager.touch(id);
      } catch {
        /* closed; the next state check ends the stream */
      }
    }, TOUCH_MS),
  );
  req.on('close', end);
  res.on('close', end);
}
