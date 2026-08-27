// Visit-attachment browser smoke.
//
// Covers the flow no other smoke touches: a home-visit attachment stored by the
// real upload pipeline, served by the guarded `FilesController`, and opened in
// the in-page viewer. The regression it guards is "every attachment downloads
// instead of opening" — which lives entirely in response headers, so the checks
// below read the headers Chrome itself received, not only what the server code
// intends to send.
//
// Coverage note: the serving branch this exercises follows the backend's own
// storage adapter — local disk here, `res.sendFile`; a backend booted with
// Supabase credentials takes the streamed object branch instead. The pass line
// says which one ran.
//
// Run against the standard smoke stack:
//   backend  PORT=3001 DB_NAME=sts_smoke CORS_ORIGINS=http://127.0.0.1:5174 pnpm start
//   frontend VITE_API_BASE_URL=http://127.0.0.1:3001 pnpm dev --host 127.0.0.1 --port 5174
//   pnpm smoke:visit-attachment-browser
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { SessionCookieService } = require('../dist/auth/session-cookie.service');
const { TaskLifecycleService } = require('../dist/task/task-lifecycle.service');
const { TaskRepository } = require('../dist/task/task.repository');
const { FILE_STORAGE_ADAPTER } = require('../dist/files/storage/file-storage.types');
const { processVisitAttachment } = require('../dist/common/file-upload/visit-photo.util');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run visit attachment browser smoke with NODE_ENV=production');
}
if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const BACKEND_URL = process.env.SMOKE_BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5174';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.SMOKE_CHROME_DEBUG_PORT || 9262);
const USERNAME = 'visit_attachment_browser_smoke';
const REASON = 'Automated visit attachment browser smoke';
const SCREENSHOT_DIR = process.env.SMOKE_SCREENSHOT_DIR || os.tmpdir();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorMessage(error) {
  if (error instanceof AggregateError) {
    return error.errors.map((cause) => cause?.message || String(cause)).join(' | ');
  }
  return error?.message || String(error);
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
    await wait(200);
  }
  const text = typeof message === 'function' ? await message() : message;
  throw new Error(lastError ? `${text}: ${errorMessage(lastError)}` : text);
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        for (const listener of this.listeners) listener(message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    });
  }

  on(listener) {
    this.listeners.add(listener);
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function openChrome() {
  assert(fs.existsSync(CHROME_PATH), 'Google Chrome executable was not found');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sts-attachment-chrome-'));
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
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return { client, processRef, userDataDir };
}

async function closeChrome(chrome) {
  if (!chrome) return;
  try {
    chrome.client.close();
  } catch {
    // best-effort cleanup only
  }
  if (chrome.processRef && !chrome.processRef.killed) {
    chrome.processRef.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => chrome.processRef.once('exit', resolve)),
      wait(1_000),
    ]);
  }
  if (chrome.userDataDir) {
    fs.rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(detail || 'Browser expression failed');
  }
  return result.result?.value;
}

async function navigate(client, url) {
  await client.call('Page.navigate', { url });
  await waitFor(
    async () => (await evaluate(client, 'document.readyState')) === 'complete',
    `Page did not finish loading: ${url}`,
  );
}

async function capture(client, name) {
  const outputPath = path.join(SCREENSHOT_DIR, name);
  const result = await client.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
  return outputPath;
}

async function pressKey(client, key, code) {
  for (const type of ['keyDown', 'keyUp']) {
    await client.call('Input.dispatchKeyEvent', {
      type,
      key,
      code: key,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
    });
  }
  await wait(150);
}

async function clickSelector(client, selector) {
  const box = await evaluate(
    client,
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      node.scrollIntoView({ block: 'center' });
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`,
  );
  assert(box, `element ${selector} was not clickable`);
  await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  for (const type of ['mousePressed', 'mouseReleased']) {
    await client.call('Input.dispatchMouseEvent', {
      type,
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    });
  }
  await wait(200);
}

// A one-page PDF small enough to inline here and real enough for a browser to
// open — the viewer frames the file by URL, so a stub with only a %PDF header
// would prove nothing about how it is served.
function buildPdf() {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '5 0 obj\n<< /Length 62 >>\nstream\nBT /F1 12 Tf 20 60 Td (STS visit attachment smoke) Tj ET\nendstream\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// Word documents are the "no browser can render this" case. An OLE header is
// all `processVisitAttachment` inspects, and the bytes never need to open.
function buildDoc() {
  const buffer = Buffer.alloc(2048);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buffer);
  buffer.write('STS visit attachment smoke document', 64, 'latin1');
  return buffer;
}

async function storeAttachments(storage) {
  const photo = await sharp({
    create: { width: 320, height: 200, channels: 3, background: { r: 210, g: 90, b: 70 } },
  })
    .jpeg()
    .toBuffer();
  const files = [
    { buffer: photo, mimetype: 'image/jpeg' },
    { buffer: buildPdf(), mimetype: 'application/pdf' },
    { buffer: buildDoc(), mimetype: 'application/msword' },
  ];
  const keys = [];
  for (const file of files) {
    keys.push(await processVisitAttachment(file, storage));
  }
  const [jpegKey, pdfKey, docKey] = keys;
  assert(jpegKey.endsWith('.jpg'), `expected a re-encoded jpeg, got ${jpegKey}`);
  assert(pdfKey.endsWith('.pdf'), `expected a pdf, got ${pdfKey}`);
  assert(docKey.endsWith('.doc'), `expected a doc, got ${docKey}`);
  return { keys, jpegKey, pdfKey, docKey };
}

async function seedCase(context, enrollment, storageKeys) {
  const { dataSource, lifecycle, repository, actorId, actorContext } = context;
  const [createdCase] = await dataSource.query(
    `INSERT INTO cases (student_uuid, student_name, school_id, student_school, reason_flagged,
       status, workflow_phase_code, created_by)
     VALUES ($1,$2,$3,$4,$5,'OPEN','FOLLOW_UP',$6) RETURNING id`,
    [
      enrollment.student_uuid,
      enrollment.student_name,
      enrollment.school_id,
      enrollment.school_name,
      REASON,
      actorId,
    ],
  );
  const caseId = Number(createdCase.id);

  const assignees = await repository.listVisitAssignees(enrollment.student_uuid);
  const assignee = assignees.find((candidate) => candidate.teacher_id);
  assert(assignee, `no assignable teacher for student ${enrollment.student_uuid}`);
  await lifecycle.createTask(
    actorContext,
    {
      task_type: 'VISIT',
      assigned_teacher_id: Number(assignee.teacher_id),
      existing_case_id: String(caseId),
      student_id: enrollment.student_uuid,
      expires_value: 1,
      expires_unit: 'days',
      target_school_id: enrollment.school_id,
      assignment_note: 'ตรวจไฟล์แนบอัตโนมัติ',
    },
    BACKEND_URL,
  );
  const [link] = await dataSource.query(
    `SELECT tl.id AS link_id, t.id AS task_id
     FROM task_links tl JOIN tasks t ON t.id = tl.task_id
     WHERE t.case_id = $1 AND tl.deleted_at IS NULL
     ORDER BY tl.created_at DESC LIMIT 1`,
    [caseId],
  );
  assert(link, 'VISIT link was not created');

  const photoPaths = storageKeys.map((key) => `/uploads/${key}`);
  await dataSource.query(
    `INSERT INTO task_submissions (
       task_link_id, visited_at, submitted_at, task_execution_outcome_code,
       follow_up_problem_category_code, cause_detail, photo_paths, created_by
     ) VALUES ($1, now(), now(), 'SUCCEEDED',
       (SELECT code FROM follow_up_problem_categories WHERE is_active = TRUE ORDER BY sort_order LIMIT 1),
       'บันทึกการเยี่ยมบ้านสำหรับตรวจไฟล์แนบ', $2, $3)`,
    [link.link_id, JSON.stringify(photoPaths), actorId],
  );
  await dataSource.query(`UPDATE tasks SET status='COMPLETED' WHERE id=$1`, [link.task_id]);
  await dataSource.query(`UPDATE task_links SET status='COMPLETED' WHERE id=$1`, [link.link_id]);

  // tasks.id is a uuid — keep it a string so the detail route stays valid.
  return { caseId, taskId: String(link.task_id), photoPaths };
}

function attachmentUrl(storageKey, { download = false } = {}) {
  return `${BACKEND_URL}/api/uploads/${storageKey}${download ? '?download=1' : ''}`;
}

async function fetchAttachment(storageKey, { cookie, download = false } = {}) {
  const response = await fetch(attachmentUrl(storageKey, { download }), {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  });
  const body = Buffer.from(await response.arrayBuffer());
  return { response, body };
}

async function assertServedHeaders(storageKey, cookie, expected) {
  const { response, body } = await fetchAttachment(storageKey, {
    cookie,
    download: expected.download,
  });
  assert(response.status === 200, `${expected.label} returned ${response.status} instead of 200`);
  assert(
    response.headers.get('content-type') === expected.contentType,
    `${expected.label} content-type was ${response.headers.get('content-type')}`,
  );
  const disposition = response.headers.get('content-disposition') || '';
  assert(
    disposition.startsWith(`${expected.disposition}; filename="`),
    `${expected.label} disposition was "${disposition}"`,
  );
  assert(
    response.headers.get('cache-control') === 'private, no-store',
    `${expected.label} cache-control was "${response.headers.get('cache-control')}"`,
  );
  assert(
    response.headers.get('x-content-type-options') === 'nosniff',
    `${expected.label} lost its nosniff header`,
  );
  assert(body.length > 0, `${expected.label} returned an empty body`);
  if (expected.magic) {
    assert(
      body.subarray(0, expected.magic.length).equals(expected.magic),
      `${expected.label} did not return the stored bytes`,
    );
  }
  return body;
}

async function assertViewerItem(client, expectation) {
  await waitFor(
    async () => await evaluate(client, `Boolean(document.querySelector('section[role="dialog"]'))`),
    'attachment viewer did not open',
  );
  const state = JSON.parse(
    await evaluate(
      client,
      `(() => {
        const dialog = document.querySelector('section[role="dialog"]');
        const image = dialog.querySelector('img');
        const frame = dialog.querySelector('iframe');
        const links = [...dialog.querySelectorAll('a')].map((anchor) => ({
          text: anchor.textContent.trim(),
          href: anchor.getAttribute('href'),
        }));
        return JSON.stringify({
          title: dialog.querySelector('h2')?.textContent.trim() || '',
          text: dialog.innerText,
          image: image ? { src: image.currentSrc || image.src, width: image.naturalWidth } : null,
          frame: frame
            ? { src: frame.getAttribute('src'), visible: frame.getClientRects().length > 0 }
            : null,
          links,
        });
      })()`,
    ),
  );
  assert(
    state.title.endsWith(expectation.titleSuffix),
    `viewer title was "${state.title}", expected to end with "${expectation.titleSuffix}"`,
  );
  if (expectation.image) {
    assert(state.image, 'viewer did not render an image');
    assert(
      state.image.src === expectation.image,
      `viewer image src was ${state.image.src}, expected ${expectation.image}`,
    );
    await waitFor(
      async () =>
        (await evaluate(
          client,
          `document.querySelector('section[role="dialog"] img')?.naturalWidth || 0`,
        )) > 0,
      'viewer image was requested but never decoded (the guarded route did not serve it)',
    );
  } else {
    assert(!state.image, 'viewer rendered an image for a non-image attachment');
  }
  if (expectation.frame) {
    assert(state.frame, 'viewer did not embed the pdf');
    assert(
      state.frame.src === expectation.frame,
      `viewer frame src was ${state.frame.src}, expected ${expectation.frame}`,
    );
    assert(
      state.frame.visible === expectation.frameVisible,
      `viewer frame visibility was ${state.frame.visible}, expected ${expectation.frameVisible}`,
    );
  }
  if (expectation.notice) {
    assert(
      state.text.includes(expectation.notice),
      `viewer did not show "${expectation.notice}": ${JSON.stringify(state.text).slice(0, 300)}`,
    );
  }
  const download = state.links.find((link) => link.text.includes('ดาวน์โหลด'));
  assert(download, 'viewer did not offer a download link');
  assert(
    download.href === `${expectation.url}?download=1`,
    `download link was ${download.href}, expected ${expectation.url}?download=1`,
  );
  const newTab = state.links.find((link) => link.text.includes('เปิดในแท็บใหม่'));
  if (expectation.newTab) {
    assert(newTab, 'viewer did not offer "open in a new tab" for a viewable file');
    assert(
      newTab.href === expectation.url,
      `new-tab link was ${newTab.href}, expected the plain ${expectation.url}`,
    );
  } else {
    assert(!newTab, 'viewer offered "open in a new tab" for a file no browser can render');
  }
  return state;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const sessionCookieService = app.get(SessionCookieService);
  const lifecycle = app.get(TaskLifecycleService);
  const repository = app.get(TaskRepository);
  const storage = app.get(FILE_STORAGE_ADAPTER);

  let chrome;
  let actorId;
  let storedKeys = [];

  try {
    const [scopedEnrollment] = await dataSource.query(
      `SELECT enrollment.student_uuid, enrollment."SchoolID_Onec" AS school_id,
              school.name AS school_name,
              CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec") AS student_name
       FROM student_term enrollment
       JOIN schools school ON school.id = enrollment."SchoolID_Onec"
       JOIN student_current_enrollment_resolution resolution
         ON resolution.selected_student_uuid = enrollment.student_uuid
        AND resolution.resolution_state = 'ACTIVE'
       WHERE NOT EXISTS (
         SELECT 1 FROM cases current_case
         WHERE current_case.student_uuid = enrollment.student_uuid
           AND current_case.deleted_at IS NULL
           AND current_case.status IN ('OPEN','IN_PROGRESS','PENDING_REVIEW','STUDENT_NOT_FOUND')
       )
       ORDER BY enrollment.student_uuid LIMIT 1`,
    );
    assert(scopedEnrollment, 'need one canonical student for the visit attachment smoke');
    const [otherSchoolEnrollment] = await dataSource.query(
      `SELECT enrollment.student_uuid, enrollment."SchoolID_Onec" AS school_id,
              school.name AS school_name,
              CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec") AS student_name
       FROM student_term enrollment
       JOIN schools school ON school.id = enrollment."SchoolID_Onec"
       JOIN student_current_enrollment_resolution resolution
         ON resolution.selected_student_uuid = enrollment.student_uuid
        AND resolution.resolution_state = 'ACTIVE'
       WHERE enrollment."SchoolID_Onec" <> $1
         AND NOT EXISTS (
           SELECT 1 FROM cases current_case
           WHERE current_case.student_uuid = enrollment.student_uuid
             AND current_case.deleted_at IS NULL
             AND current_case.status IN ('OPEN','IN_PROGRESS','PENDING_REVIEW','STUDENT_NOT_FOUND')
         )
       ORDER BY enrollment."SchoolID_Onec", enrollment.student_uuid LIMIT 1`,
      [scopedEnrollment.school_id],
    );
    assert(
      otherSchoolEnrollment,
      'need a student from a second school to prove the scope boundary',
    );

    // Deliberately the page permission and nothing else: permissions are
    // page-bound, so holding `dashboard` — which opens /tasks/:id — has to be
    // enough to open the attachments that page renders. `students` is left out
    // so the check fails if the file route is ever tightened past its page.
    const permissions = ['home', 'dashboard'];
    const [actor] = await dataSource.query(
      `INSERT INTO users (username, password, "FirstName", "LastName", status, permissions,
         role, data_scope, must_change_password, data_origin_code)
       VALUES ($1, 'x', 'Visit', 'Attachment Smoke', 'ACTIVE', $2::jsonb, 'ADMIN', $3::jsonb,
         FALSE, 'AUTOMATED_TEST')
       ON CONFLICT (username) DO UPDATE SET status='ACTIVE', permissions=$2::jsonb,
         data_scope=$3::jsonb, role='ADMIN', data_origin_code='AUTOMATED_TEST',
         deactivated_at=NULL, deactivated_by=NULL, deactivation_reason_code=NULL,
         deactivation_note=NULL
       RETURNING id`,
      [
        USERNAME,
        JSON.stringify(permissions),
        JSON.stringify({ school_ids: [Number(scopedEnrollment.school_id)] }),
      ],
    );
    actorId = Number(actor.id);
    await cleanupFixtures(dataSource, actorId, storage);

    // Seeding runs with a global context so the out-of-scope case can be built
    // at all; the served requests authenticate as the stored user, whose scope
    // is the single school above.
    const context = {
      dataSource,
      lifecycle,
      repository,
      actorId,
      actorContext: {
        id: actorId,
        username: USERNAME,
        roles: ['ADMIN'],
        permissions,
        data_scope: { global: true },
      },
    };

    const attachments = await storeAttachments(storage);
    const hidden = await storeAttachments(storage);
    storedKeys = [...attachments.keys, ...hidden.keys];
    const visible = await seedCase(context, scopedEnrollment, attachments.keys);
    await seedCase(context, otherSchoolEnrollment, hidden.keys);

    let cookie = null;
    sessionCookieService.setSession(
      { cookie: (name, value) => (cookie = { name, value }) },
      actorId,
    );
    assert(cookie, 'session cookie was not created');
    const cookieHeader = `${cookie.name}=${cookie.value}`;

    // --- served headers -----------------------------------------------------
    const jpegBody = await assertServedHeaders(attachments.jpegKey, cookieHeader, {
      label: 'photo',
      contentType: 'image/jpeg',
      disposition: 'inline',
      magic: Buffer.from([0xff, 0xd8, 0xff]),
    });
    await assertServedHeaders(attachments.pdfKey, cookieHeader, {
      label: 'pdf',
      contentType: 'application/pdf',
      disposition: 'inline',
      magic: Buffer.from('%PDF-'),
    });
    await assertServedHeaders(attachments.docKey, cookieHeader, {
      label: 'word document',
      contentType: 'application/msword',
      disposition: 'attachment',
    });
    await assertServedHeaders(attachments.jpegKey, cookieHeader, {
      label: 'photo with ?download=1',
      contentType: 'image/jpeg',
      disposition: 'attachment',
      download: true,
      magic: Buffer.from([0xff, 0xd8, 0xff]),
    });

    const anonymous = await fetchAttachment(attachments.jpegKey);
    assert(
      anonymous.response.status === 401,
      `an unauthenticated attachment request returned ${anonymous.response.status}`,
    );
    const outOfScope = await fetchAttachment(hidden.jpegKey, { cookie: cookieHeader });
    assert(
      outOfScope.response.status === 404,
      `an out-of-scope attachment returned ${outOfScope.response.status} instead of 404`,
    );
    const missing = await fetchAttachment('visit-attachments/deadbeef.jpg', {
      cookie: cookieHeader,
    });
    assert(
      missing.response.status === 404,
      `a missing attachment returned ${missing.response.status} instead of 404`,
    );

    // A task id is a uuid; a mistyped one is a bad request, not a server fault.
    const malformedTaskId = await fetch(`${BACKEND_URL}/api/tasks/not-a-uuid/chain`, {
      headers: { cookie: cookieHeader },
    });
    assert(
      malformedTaskId.status === 400,
      `a non-uuid task id returned ${malformedTaskId.status} instead of 400`,
    );

    // --- browser ------------------------------------------------------------
    chrome = await openChrome();
    const { client } = chrome;
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Network.enable');
    const observedResponses = new Map();
    client.on((message) => {
      if (message.method !== 'Network.responseReceived') return;
      const { url, headers } = message.params.response;
      observedResponses.set(url, headers);
    });
    await client.call('Network.setCookie', {
      name: cookie.name,
      value: cookie.value,
      url: BACKEND_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await navigate(client, `${FRONTEND_URL}/login`);
    const sessionUser = {
      id: actorId,
      username: USERNAME,
      FirstName: 'Visit',
      LastName: 'Attachment Smoke',
      role: 'ADMIN',
      permissions,
    };
    await evaluate(
      client,
      `localStorage.setItem('sts_user', ${JSON.stringify(JSON.stringify(sessionUser))});
       localStorage.setItem('admin_access', 'true'); true`,
    );

    await navigate(client, `${FRONTEND_URL}/tasks/${visible.taskId}`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('ไฟล์แนบการติดตาม'),
      async () =>
        `task detail did not render the attachment section (body="${String(
          await evaluate(client, 'document.body.innerText').catch(() => ''),
        ).slice(0, 300)}")`,
    );

    const jpegUrl = attachmentUrl(attachments.jpegKey);
    const pdfUrl = attachmentUrl(attachments.pdfKey);
    const docUrl = attachmentUrl(attachments.docKey);

    const thumbnails = JSON.parse(
      await evaluate(
        client,
        `JSON.stringify([...document.querySelectorAll('a[aria-label^="เปิดดู"]')].map((anchor) => ({
          label: anchor.getAttribute('aria-label'),
          href: anchor.getAttribute('href'),
          hasImage: Boolean(anchor.querySelector('img')),
        })))`,
      ),
    );
    assert(thumbnails.length === 3, `expected 3 attachment tiles, got ${thumbnails.length}`);
    assert(
      thumbnails[0].href === jpegUrl && thumbnails[0].hasImage,
      `the photo tile pointed at ${thumbnails[0].href}`,
    );
    assert(
      thumbnails[1].href === pdfUrl && !thumbnails[1].hasImage,
      `the pdf tile pointed at ${thumbnails[1].href}`,
    );
    assert(
      thumbnails[2].label.endsWith('.doc'),
      `the document tile was labelled "${thumbnails[2].label}"`,
    );

    // The thumbnail decodes only if the guarded route answered with real image
    // bytes and a type the browser accepts — this is the check a redirect to an
    // `application/octet-stream` object would fail.
    await waitFor(
      async () =>
        (await evaluate(
          client,
          `document.querySelector('a[aria-label^="เปิดดู"] img')?.naturalWidth || 0`,
        )) > 0,
      'the attachment thumbnail never decoded in the browser',
    );

    const observedPhotoHeaders = observedResponses.get(jpegUrl);
    assert(observedPhotoHeaders, `Chrome never requested ${jpegUrl}`);
    const observedDisposition =
      observedPhotoHeaders['content-disposition'] || observedPhotoHeaders['Content-Disposition'];
    assert(
      String(observedDisposition).startsWith('inline;'),
      `Chrome received "${observedDisposition}" for the photo instead of an inline disposition`,
    );

    const pathnameBefore = await evaluate(client, 'location.pathname');
    await clickSelector(client, 'a[aria-label^="เปิดดู"]');
    assert(
      (await evaluate(client, 'location.pathname')) === pathnameBefore,
      'clicking an attachment navigated away instead of opening the viewer',
    );
    await assertViewerItem(client, {
      titleSuffix: '.jpg',
      image: jpegUrl,
      url: jpegUrl,
      newTab: true,
    });
    const desktopShot = await capture(client, 'sts-visit-attachment-desktop.png');

    await pressKey(client, 'ArrowRight', 39);
    await assertViewerItem(client, {
      titleSuffix: '.pdf',
      frame: pdfUrl,
      frameVisible: true,
      url: pdfUrl,
      newTab: true,
    });

    await pressKey(client, 'ArrowRight', 39);
    await assertViewerItem(client, {
      titleSuffix: '.doc',
      notice: 'ไฟล์ชนิดนี้เปิดดูในเบราว์เซอร์ไม่ได้',
      url: docUrl,
      newTab: false,
    });

    await pressKey(client, 'Escape', 27);
    await waitFor(
      async () =>
        !(await evaluate(client, `Boolean(document.querySelector('section[role="dialog"]'))`)),
      'the viewer stayed open after Escape',
    );

    // --- mobile -------------------------------------------------------------
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate(client, `${FRONTEND_URL}/tasks/${visible.taskId}`);
    await waitFor(
      async () =>
        String(await evaluate(client, 'document.body.innerText')).includes('ไฟล์แนบการติดตาม'),
      'mobile task detail did not render the attachment section',
    );
    await clickSelector(client, 'a[aria-label^="เปิดดู"]');
    await assertViewerItem(client, {
      titleSuffix: '.jpg',
      image: jpegUrl,
      url: jpegUrl,
      newTab: true,
    });
    await pressKey(client, 'ArrowRight', 39);
    await assertViewerItem(client, {
      titleSuffix: '.pdf',
      frame: pdfUrl,
      // A framed PDF is an unusable crop on a phone, so the frame is hidden and
      // the notice takes over.
      frameVisible: false,
      notice: 'ดูไฟล์ PDF บนมือถือได้ที่แท็บใหม่',
      url: pdfUrl,
      newTab: true,
    });
    const mobileShot = await capture(client, 'sts-visit-attachment-mobile.png');

    console.log(
      [
        'visit attachment browser smoke passed',
        `(photo ${jpegBody.length} bytes served inline, pdf inline, doc attachment,`,
        '?download=1 forces attachment, 401 without a session, 404 out of scope and for a missing object,',
        'the page permission alone opens every attachment, a non-uuid task id is a 400,',
        'thumbnail decoded in Chrome, viewer opens in place with arrow paging, desktop/mobile pdf treatment)',
        `screenshots: ${desktopShot}, ${mobileShot}`,
        // Which serving branch actually ran depends on the environment the
        // backend booted with, so say it out loud instead of implying both.
        storage.kind === 'local'
          ? '[storage=local disk: res.sendFile branch; the object-stream branch needs Supabase credentials]'
          : '[storage=private object: the streamed branch was exercised]',
      ].join(' '),
    );
  } catch (error) {
    if (chrome) {
      try {
        const shot = await capture(chrome.client, 'sts-visit-attachment-failure.png');
        console.error(`failure screenshot: ${shot}`);
      } catch {
        // best-effort diagnostics only
      }
    }
    throw error;
  } finally {
    await closeChrome(chrome);
    await cleanupFixtures(dataSource, actorId, storage, storedKeys);
    if (actorId) {
      await dataSource.query(
        `UPDATE users
         SET status='DISABLED', deactivated_at=now(), deactivation_reason_code='OTHER',
             deactivation_note='Browser smoke fixture'
         WHERE id=$1 AND username=$2`,
        [actorId, USERNAME],
      );
    }
    await app.close();
  }
}

async function cleanupFixtures(dataSource, actorId, storage, storageKeys = []) {
  if (actorId) {
    await dataSource.transaction(async (manager) => {
      const caseFilter = `SELECT id FROM cases WHERE created_by = $1`;
      const taskFilter = `SELECT id FROM tasks WHERE case_id IN (${caseFilter})`;
      const linkFilter = `SELECT id FROM task_links WHERE task_id IN (${taskFilter})`;
      await manager.query(`DELETE FROM task_submissions WHERE task_link_id IN (${linkFilter})`, [
        actorId,
      ]);
      await manager.query(`DELETE FROM notifications WHERE case_id IN (${caseFilter})`, [actorId]);
      await manager.query(`DELETE FROM cases WHERE id IN (${caseFilter})`, [actorId]);
    });
  }
  for (const key of storageKeys) {
    await storage.delete(key).catch(() => {
      // A file the smoke never managed to store is not worth failing cleanup.
    });
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
