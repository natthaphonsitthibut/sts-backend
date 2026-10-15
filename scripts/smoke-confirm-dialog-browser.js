const fs = require('fs');
const { assert, openChrome, waitFor } = require('./smoke-case-assistance-browser');
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';

// Real shared useConfirm in a browser harness reproducing NlQueryPage's sticky
// sidebar beside a canvas. No conversations or other application data change.
async function main() {
  const chrome = await openChrome();
  try {
    await chrome.call('Page.enable');
    await chrome.call('Page.navigate', { url: `${FRONTEND_URL}/login` });
    await waitFor(async () => await chrome.evaluate(`document.readyState === 'complete'`), 'frontend did not load');
    await chrome.evaluate(`(async () => {
      const confirmSource = await fetch('/src/components/base/confirm-dialog.tsx').then(r => r.text());
      const mainSource = await fetch('/src/main.tsx').then(r => r.text());
      const reactUrl = confirmSource.match(/from "([^"]+react[.]js[^"]*)"/)[1];
      const domUrl = mainSource.match(/from "([^"]+react-dom_client[.]js[^"]*)"/)[1];
      const React = (await import(reactUrl)).default;
      const dom = await import(domUrl);
      const { useConfirm } = await import('/src/components/base/confirm-dialog.tsx');
      document.getElementById('root').style.display = 'none';
      const host = document.createElement('div');
      document.body.appendChild(host);
      function Harness() {
        const { confirm, dialog } = useConfirm();
        return React.createElement('div', { style: { display: 'flex' } },
          React.createElement('aside', { id: 'sticky-sidebar', style: { position: 'sticky', top: 0, zIndex: 0, width: '30%' } },
            React.createElement('button', { onClick: async () => {
              window.__confirmationResult = await confirm({ title: 'ลบบทสนทนานี้?',
                description: 'ประวัติของบทสนทนานี้จะถูกลบและกู้คืนไม่ได้', confirmText: 'ลบ', variant: 'destructive' });
            } }, 'ลบบทสนทนา'), dialog),
          React.createElement('canvas', { width: 800, height: 800, style: { position: 'relative', zIndex: 1, background: 'var(--color-primary)' } }));
      }
      (dom.createRoot || dom.default.createRoot)(host).render(React.createElement(Harness));
    })()`);
    await waitFor(async () => await chrome.evaluate(`Boolean(document.querySelector('#sticky-sidebar button'))`), 'dialog harness did not mount');
    for (const width of [1366, 390]) {
      await chrome.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await chrome.evaluate(`document.querySelector('#sticky-sidebar button').click()`);
      await waitFor(async () => await chrome.evaluate(`Boolean(document.querySelector('[role="dialog"]'))`), 'confirmation did not open');
      await waitFor(async () => await chrome.evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return getComputedStyle(dialog).opacity === '1' && getComputedStyle(dialog).transform === 'none';
      })()`), 'dialog entrance did not finish');
      const state = await chrome.evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const box = dialog.getBoundingClientRect();
        return {
          aboveCanvas: dialog.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)),
          background: getComputedStyle(dialog).backgroundColor,
          escapedSidebar: !document.querySelector('#sticky-sidebar').contains(dialog),
          fits: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
        };
      })()`);
      assert(state.aboveCanvas && state.escapedSidebar && state.fits && state.background === 'rgb(255, 255, 255)',
        `confirmation layering failed at ${width}px: ${JSON.stringify(state)}`);
      fs.writeFileSync(`/tmp/sts-confirm-dialog-${width}.png`, Buffer.from(
        (await chrome.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
      await chrome.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await chrome.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await waitFor(async () => await chrome.evaluate(`!document.querySelector('[role="dialog"]') && window.__confirmationResult === false`),
        'Escape did not cancel the confirmation');
    }
    console.log('confirm dialog browser smoke passed: opaque above sticky sibling canvas, fits desktop/mobile, Escape cancels');
  } finally { chrome.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
