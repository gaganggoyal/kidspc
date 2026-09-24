/**
 * Headless Chrome, driven over the DevTools protocol through a pipe.
 *
 * A pipe rather than the usual WebSocket so this needs nothing installed: Node
 * 20 has no WebSocket of its own, and the video tooling is not worth a
 * dependency. Chrome reads JSON messages on fd 3 and answers on fd 4, each
 * terminated by a NUL byte.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME =
  process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launch({ width = 1920, height = 1080, scale = 1, mobile = false } = {}) {
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-pipe',
      '--hide-scrollbars',
      '--mute-audio',
      '--force-color-profile=srgb',
      `--window-size=${width},${height}`,
      `--user-data-dir=/tmp/kidspc-video-${process.pid}-${width}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  );
  const toChrome = proc.stdio[3];
  const fromChrome = proc.stdio[4];

  let nextId = 0;
  let sessionId;
  const pending = new Map();
  let buffer = '';
  fromChrome.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });

  const raw = (method, params = {}, session) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      toChrome.write(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }) + '\0');
    });

  const { targetInfos } = await raw('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  ({ sessionId } = await raw('Target.attachToTarget', { targetId: page.targetId, flatten: true }));
  const send = (method, params) => raw(method, params, sessionId);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: scale,
    mobile,
  });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const KEYS = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27 };

  const api = {
    send,
    async go(url, settle = 1500) {
      await send('Page.navigate', { url });
      await sleep(settle);
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async key(key, gap = 160) {
      const code = KEYS[key] ?? key.toUpperCase().charCodeAt(0);
      const text = key === 'Enter' ? '\r' : key.length === 1 ? key : undefined;
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code });
      if (text) await send('Input.dispatchKeyEvent', { type: 'char', key, text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
      await sleep(gap);
    },
    // Inserted as text, not as key presses: a key press is a virtual key
    // code, and "." is 46 -- which Chrome reads as Delete.
    async type(text, gap = 90) {
      for (const ch of text) {
        await send('Input.insertText', { text: ch });
        await sleep(gap);
      }
    },
    async shot(file, { format = 'png', quality } = {}) {
      const r = await send('Page.captureScreenshot', { format, ...(quality ? { quality } : {}) });
      writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    async close() {
      try {
        await raw('Browser.close');
      } catch {
        /* already gone */
      }
      proc.kill();
    },
  };
  return api;
}
