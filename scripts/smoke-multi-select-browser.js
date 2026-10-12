/** Real keyboard/focus proof using the shared components; no database or account is needed. */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { assert, openChrome, waitFor } = require('./smoke-case-assistance-browser');

const frontend = path.resolve(__dirname, '../../sts-frontend');
const baseUrl = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const stem = `smoke-multi-select-${randomUUID()}`;
const htmlPath = path.join(frontend, `${stem}.html`);
const tsxPath = path.join(frontend, `${stem}.tsx`);
if (process.env.NODE_ENV === 'production')
  throw new Error('Refusing browser fixture in production');

async function main() {
  let chrome;
  const cleanup = () => {
    try {
      chrome?.close();
    } finally {
      fs.rmSync(htmlPath, { force: true });
      fs.rmSync(tsxPath, { force: true });
    }
  };
  const interrupt = () => {
    cleanup();
    process.exit(130);
  };
  const terminate = () => {
    cleanup();
    process.exit(143);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    fs.writeFileSync(
      htmlPath,
      `<html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/${stem}.tsx"></script></body></html>`,
      { flag: 'wx' },
    );
    fs.writeFileSync(
      tsxPath,
      `import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Dialog,DialogContent,DialogTitle} from './src/components/base/dialog';
import {MultiSelect} from './src/components/base/multi-select';
import './src/index.css';
function App(){const [open,setOpen]=useState(true);const [value,setValue]=useState<string[]>([]);const [longList,setLongList]=useState(false);
return <><button onClick={()=>setOpen(true)}>Open parent</button><Dialog open={open} onOpenChange={setOpen}>
<DialogContent><DialogTitle>Parent form</DialogTitle><MultiSelect id="keyboard-picker" ariaLabel="Nested choices"
placeholder="Pick" value={value} onChange={setValue} options={[{value:'a',label:'First choice'},{value:'b',label:'Second choice'},...(longList?Array.from({length:10},(_,i)=>({value:'extra'+i,label:'Extra choice '+i})):[])]} />
<button id="use-long-list" onClick={()=>{setLongList(true);setValue([])}}>Use long list</button>
<button id="parent-save">Save parent</button></DialogContent></Dialog></>}
createRoot(document.getElementById('root')!).render(<App/>);`,
      { flag: 'wx' },
    );
    chrome = await openChrome();
    await chrome.call('Page.enable');
    const key = async (name, modifiers = 0) => {
      const code = { Tab: 9, Escape: 27, Enter: 13, ArrowDown: 40, ' ': 32 }[name];
      for (const type of ['keyDown', 'keyUp']) {
        await chrome.call('Input.dispatchKeyEvent', {
          type,
          key: name,
          code: name === ' ' ? 'Space' : name,
          windowsVirtualKeyCode: code,
          nativeVirtualKeyCode: code,
          ...(name === 'Enter' && type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}),
          modifiers,
        });
      }
    };
    const click = async (selector) => {
      const box = await chrome.evaluate(`(() => {
        const node=document.querySelector(${JSON.stringify(selector)}); if(!node)return null;
        node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      assert(box, 'keyboard fixture control missing');
      for (const type of ['mousePressed', 'mouseReleased']) {
        await chrome.call('Input.dispatchMouseEvent', {
          type,
          ...box,
          button: 'left',
          clickCount: 1,
        });
      }
    };
    const sheet = `document.querySelector('[role="dialog"][aria-label="Nested choices"]')`;
    const focusedInSheet = () =>
      chrome.evaluate(`Boolean(${sheet}?.contains(document.activeElement))`);
    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await chrome.call('Page.navigate', { url: `${baseUrl}/${stem}.html` });
    await waitFor(
      async () => await chrome.evaluate(`Boolean(document.querySelector('#keyboard-picker'))`),
      'parent form missing',
    );
    assert(await chrome.evaluate(`(async () => {
      const token='draft-upgrade-fixture';
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
      const key=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      const legacy=await new Promise((resolve,reject)=>{
        const request=indexedDB.open('sts-visit-report-drafts',3);
        request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'key'});
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      await new Promise((resolve,reject)=>{
        const tx=legacy.transaction('drafts','readwrite');
        tx.objectStore('drafts').put({version:3,key,updatedAt:new Date().toISOString(),
          expiresAt:new Date(Date.now()+60000).toISOString(),latitude:'13.7',longitude:'100.5',
          files:[new File(['evidence'],'evidence.txt')],
          formValues:{guardianTypeCode:'FATHER_AND_MOTHER',contactChannelCode:'OTHER',causeDetail:'unfinished'}});
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
      });
      try {
        const {loadVisitReportDraft,deleteVisitReportDraft}=await import('/src/features/tasks/lib/visit-report-draft.ts');
        const draft=await loadVisitReportDraft(token);
        const preserved=legacy.version===3 && draft?.version===4
          && JSON.stringify(draft.formValues.guardianTypeCodes)===JSON.stringify(['FATHER','MOTHER'])
          && draft.formValues.causeDetail==='unfinished' && draft.formValues.contactChannelDetail===''
          && draft.latitude==='13.7' && await draft.files[0].text()==='evidence';
        await new Promise((resolve,reject)=>{
          const tx=legacy.transaction('drafts','readwrite');tx.objectStore('drafts').put({...draft,version:3});
          tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
        });
        await deleteVisitReportDraft(token);return preserved;
      } finally {legacy.close();}
    })()`), 'draft upgrade must preserve answers/files and let the already-open v3 tab keep saving');
    console.log('PASS native IndexedDB: v3 draft answers/files preserved, both parents converted, old tab still saves');
    assert(await chrome.evaluate(`(async () => {
      const {loadVisitReportDraft,saveVisitReportDraft,deleteVisitReportDraft}=await import('/src/features/tasks/lib/visit-report-draft.ts');
      const open=(version)=>new Promise((resolve,reject)=>{
        const request=indexedDB.open('sts-visit-report-drafts',version);
        request.onupgradeneeded=()=>{
          if(!request.result.objectStoreNames.contains('drafts'))request.result.createObjectStore('drafts',{keyPath:'key'});
        };
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      for(const version of [1,2]) {
        await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('sts-visit-report-drafts');request.onsuccess=resolve;request.onerror=()=>reject(request.error)});
        const legacy=await open(version);
        await new Promise((resolve,reject)=>{const tx=legacy.transaction('drafts','readwrite');tx.objectStore('drafts').put({key:'raw-token-fixture',version});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
        legacy.close();
        await saveVisitReportDraft({token:'fixture-new',formValues:{causeDetail:'new'},latitude:'',longitude:'',files:[]});
        const current=await open(3);
        const keys=await new Promise((resolve,reject)=>{const request=current.transaction('drafts').objectStore('drafts').getAllKeys();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
        current.close();
        if(keys.length!==1 || keys[0]==='raw-token-fixture' || !/^[a-f0-9]{64}$/.test(keys[0]))return false;
        if((await loadVisitReportDraft('fixture-new'))?.formValues.causeDetail!=='new')return false;
        await deleteVisitReportDraft('fixture-new');
      }
      const v4=await open(4);v4.close();
      await saveVisitReportDraft({token:'fixture-v4',formValues:{contactChannelDetail:'kept'},latitude:'',longitude:'',files:[]});
      const kept=(await loadVisitReportDraft('fixture-v4'))?.formValues.contactChannelDetail==='kept';
      await deleteVisitReportDraft('fixture-v4');return kept;
    })()`), 'legacy raw-token cleanup and existing v4 database compatibility must hold in real IndexedDB');
    console.log('PASS native IndexedDB: v1/v2 raw-key cleanup, hashed saves, existing physical v4 compatibility');
    await click('#keyboard-picker');
    await waitFor(focusedInSheet, 'mobile sheet did not take initial focus');
    await key('Tab', 8);
    assert(
      (await chrome.evaluate('document.activeElement.textContent.trim()')) === 'เสร็จ',
      'Shift+Tab escaped the sheet',
    );
    await key('Tab');
    assert(await focusedInSheet(), 'Tab escaped the sheet');
    await waitFor(
      async () => await chrome.evaluate(`${sheet}.getAnimations().length === 0`),
      'sheet animation unfinished',
    );
    await click('[role="dialog"][aria-label="Nested choices"] [role="option"]');
    await chrome.evaluate(`[...${sheet}.querySelectorAll('button')].find(button => button.textContent.trim() === 'ล้าง').focus()`);
    await key('Enter');
    await waitFor(async () => await chrome.evaluate(`Boolean([...${sheet}.querySelectorAll('button')].find(button => button.textContent.trim() === 'ล้าง')?.disabled)`),
      'keyboard Enter did not clear the mobile picks');
    assert(await chrome.evaluate(`Boolean(${sheet}?.contains(document.activeElement) && !document.activeElement.disabled)`),
      'mobile Clear left focus on a disabled control');
    await key('Escape');
    await waitFor(
      async () => await chrome.evaluate(`document.querySelectorAll('[role="dialog"]').length === 1`),
      'Escape failed after mobile Clear disabled the focused button',
    );
    assert(await chrome.evaluate(`document.activeElement.id === 'keyboard-picker'`),
      'mobile Clear then Escape did not restore the trigger');
    await click('#keyboard-picker');
    await waitFor(focusedInSheet, 'focus did not return to reopened sheet');
    await key('Tab');
    assert(await focusedInSheet(), 'Tab escaped the reopened sheet with Clear disabled');
    await chrome.evaluate(`${sheet}.querySelector('[role="option"]').focus()`);
    await key('Escape');
    await waitFor(
      async () =>
        await chrome.evaluate(`document.querySelectorAll('[role="dialog"]').length === 1`),
      'Escape closed both dialog levels',
    );
    assert(
      await chrome.evaluate(`document.activeElement.id === 'keyboard-picker'`),
      'Escape did not return focus to the trigger',
    );
    await key('Escape');
    await waitFor(
      async () =>
        await chrome.evaluate(`document.querySelectorAll('[role="dialog"]').length === 0`),
      'second Escape did not close the parent',
    );
    console.log(
      'PASS mobile nested sheet: initial focus, Tab/Shift+Tab, Clear, option Escape, parent preserved, focus return',
    );

    await chrome.call('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await chrome.clickText('Open parent');
    await waitFor(
      async () => await chrome.evaluate(`Boolean(document.querySelector('#keyboard-picker'))`),
      'desktop form missing',
    );
    await click('#keyboard-picker');
    await waitFor(
      async () => await chrome.evaluate(`Boolean(document.querySelector('[role="listbox"]'))`),
      'desktop picker missing',
    );
    await chrome.evaluate(`document.querySelector('[role="option"]').focus()`);
    await key('Escape');
    assert(
      await chrome.evaluate(
        `!document.querySelector('[role="listbox"]') && document.querySelectorAll('[role="dialog"]').length === 1`,
      ),
      'desktop Escape dismissed its parent',
    );
    console.log('PASS desktop picker: option Escape dismisses only the picker');
    for (const label of ['ล้าง', 'เสร็จ']) {
      await click('#keyboard-picker');
      await waitFor(
        async () => await chrome.evaluate(`Boolean(document.querySelector('[role="listbox"]'))`),
        'desktop picker missing before footer Escape',
      );
      if (label === 'ล้าง') await click('[role="option"]');
      const focused = await chrome.evaluate(`(() => {
        const panel=document.querySelector('[role="listbox"]')?.parentElement;
        const button=[...(panel?.querySelectorAll('button') || [])]
          .find(node=>node.textContent.trim()===${JSON.stringify(label)});
        button?.focus(); return Boolean(button && document.activeElement===button);
      })()`);
      assert(focused, 'desktop footer button did not take focus');
      await key('Escape');
      assert(
        await chrome.evaluate(
          `!document.querySelector('[role="listbox"]') && document.querySelectorAll('[role="dialog"]').length === 1 && document.activeElement.id === 'keyboard-picker'`,
        ),
        'desktop footer Escape dismissed its parent or lost trigger focus',
      );
    }
    console.log('PASS desktop footer: Clear/Done Escape preserves parent and restores trigger focus');
    await click('#keyboard-picker');
    await waitFor(
      async () => await chrome.evaluate(`Boolean(document.querySelector('[role="listbox"]'))`),
      'desktop picker missing before activating Clear',
    );
    await chrome.clickText('ล้าง', `document.querySelector('[role="listbox"]').parentElement`);
    await key('Escape');
    assert(
      await chrome.evaluate(
        `!document.querySelector('[role="listbox"]') && document.querySelectorAll('[role="dialog"]').length === 1 && document.activeElement.id === 'keyboard-picker'`,
      ),
      'Escape after activating Clear dismissed its parent or lost trigger focus',
    );
    console.log('PASS desktop Clear activation: Escape preserves parent and restores trigger focus');
    for (const searchable of [false, true]) {
      if (searchable) await click('#use-long-list');
      await click('#keyboard-picker');
      await waitFor(
        async () => await chrome.evaluate(`Boolean(document.querySelector('[role="listbox"]'))`),
        'desktop picker missing before removing a chip',
      );
      await click('[role="option"]');
      await click('button[aria-label="นำ First choice ออก"]');
      await key('Escape');
      assert(
        await chrome.evaluate(
          `!document.querySelector('[role="listbox"]') && document.querySelectorAll('[role="dialog"]').length === 1 && document.activeElement.id === 'keyboard-picker'`,
        ),
        'Escape after removing a chip dismissed its parent or lost trigger focus',
      );
      if (searchable) {
        await click('#keyboard-picker');
        await waitFor(
          async () => await chrome.evaluate(`Boolean(document.querySelector('[role="listbox"]'))`),
          'searchable desktop picker missing before clearing',
        );
        await click('[role="option"]');
        await chrome.clickText('ล้าง', `document.querySelector('[role="listbox"]').parentElement`);
        await key('Escape');
        assert(
          await chrome.evaluate(
            `!document.querySelector('[role="listbox"]') && document.querySelectorAll('[role="dialog"]').length === 1 && document.activeElement.id === 'keyboard-picker'`,
          ),
          'searchable Clear activation dismissed its parent or lost trigger focus',
        );
      }
    }
    console.log('PASS short/searchable desktop: chip removal and Clear followed by Escape preserve parent and trigger focus');
    await click('#keyboard-picker');
    await waitFor(async () => await chrome.evaluate(`Boolean(document.querySelector('[role="listbox"]'))`), 'desktop picker missing before Tab');
    await key('Tab');
    await waitFor(async () => await chrome.evaluate(`!document.querySelector('[role="listbox"]')`), 'Tab away must dismiss the picker');
    assert(await chrome.evaluate(`document.querySelectorAll('[role="dialog"]').length===1 && document.activeElement.id==='use-long-list'`), 'Tab must preserve the parent and move to the next field');
    await click('#keyboard-picker');
    await waitFor(async () => await chrome.evaluate(`Boolean(document.querySelector('[role="listbox"]'))`), 'desktop picker missing before keyboard picks');
    await chrome.evaluate(`document.querySelector('[role="option"]').focus()`);
    await key(' ');
    await key('ArrowDown');
    await key(' ');
    assert(await chrome.evaluate(`(() => {
      const options=[...document.querySelectorAll('[role="option"]')];
      return options[0].getAttribute('aria-selected')==='true' && options[1].getAttribute('aria-selected')==='true'
        && document.activeElement===options[1];
    })()`), 'native Space must toggle each option once and retain focus for ArrowDown');
    await key('Escape');
    console.log('PASS desktop keyboard: Tab dismisses without closing parent; Space/ArrowDown picks twice without focus reset');
    await click('#keyboard-picker');
    await waitFor(async () => await chrome.evaluate(`Boolean(document.querySelector('[role="listbox"]'))`), 'desktop picker missing before clicking its summary');
    await click('[role="listbox"] + div p');
    assert(await chrome.evaluate(`document.activeElement===document.body`), 'summary click must reproduce focus on body');
    await key('Escape');
    assert(await chrome.evaluate(`!document.querySelector('[role="listbox"]') && document.querySelectorAll('[role="dialog"]').length===1 && document.activeElement.id==='keyboard-picker'`), 'Escape on body must close only the picker and return focus');
    console.log('PASS desktop summary: body focus + Escape preserves the parent dialog');
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    cleanup();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
