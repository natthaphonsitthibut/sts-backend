const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9257);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  const text = typeof message === 'function' ? await message() : message;
  throw new Error(lastError ? `${text}: ${lastError.message}` : text);
}

async function openChrome() {
  assert(fs.existsSync(CHROME_PATH), 'Google Chrome executable was not found');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-browser-smoke-'));
  const processRef = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).catch(() => null);
    return Boolean(response?.ok);
  }, 'Chrome DevTools endpoint did not start');

  const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((res) => res.json());
  const target = targets.find((item) => item.type === 'page');
  assert(target?.webSocketDebuggerUrl, 'Chrome page target was not available');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  await new Promise((resolve) => socket.addEventListener('open', resolve));

  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const message = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (message.result?.exceptionDetails) {
      throw new Error(message.result.exceptionDetails.exception?.description || 'evaluate failed');
    }
    return message.result?.result?.value;
  };
  const clickText = async (text, scope = 'document') => {
    const box = await evaluate(
      `(() => {
        const root = ${scope} || document;
        const wanted = ${JSON.stringify(text)};
        const buttons = [...root.querySelectorAll('button')];
        const button = buttons.find((item) => item.textContent.trim() === wanted)
          || buttons.find((item) => item.textContent.trim().startsWith(wanted));
        if (!button) return null;
        button.scrollIntoView({ block: 'center' });
        const rect = button.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`,
    );
    assert(box, `button "${text}" was not on the page`);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    });
    await call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    });
  };

  return {
    call,
    evaluate,
    clickText,
    close: () => {
      socket.close();
      processRef.kill();
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // The OS temp sweeper will remove a profile Chrome still holds briefly.
      }
    },
  };
}

module.exports = { assert, openChrome, wait, waitFor };
