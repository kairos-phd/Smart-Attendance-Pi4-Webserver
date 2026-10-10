const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function moduleFrom(file, dependencies, env = {}, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replaceAll('import.meta.env', '__env');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => dependencies[name] ?? (name === './TablePagination' ? moduleFrom('src/components/TablePagination.tsx', {...dependencies, './paginationUtils': moduleFrom('src/components/paginationUtils.ts', {})}) : undefined), __env: env, console, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, ...globals });
  return exports;
}

test('Pi API uses separate media origin and verified user token', async () => {
  const calls = [];
  const api = moduleFrom('src/api.ts', {'./firebase': {auth: {currentUser: {getIdToken: async () => 'verified'}}}}, {VITE_API_BASE_URL: 'https://attendance.example', VITE_PI_API_BASE_URL: 'https://media.example/'}, {fetch: async (...args) => { calls.push(args); return {ok: true, json: async () => ({})}; }});
  await api.getPiStatus();
  await api.getUsers();
  assert.equal(calls[0][0], 'https://media.example/api/pi/status');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer verified');
  assert.equal(calls[1][0], 'https://attendance.example/api/users');
});

test('Pi API falls back to existing attendance origin', async () => {
  let url;
  const api = moduleFrom('src/api.ts', {'./firebase': {auth: {currentUser: {getIdToken: async () => 'verified'}}}}, {VITE_API_BASE_URL: 'https://attendance.example'}, {fetch: async value => { url = value; return {ok: true, json: async () => ({})}; }});
  await api.getPiStatus();
  assert.equal(url, 'https://attendance.example/api/pi/status');
});

test('Pi status survives unavailable events and ignores attendance offline state', async () => {
  const states = [];
  const effects = [];
  let index = 0;
  let firstBoolean = true;
  const status = {pi_id: 'pi', camera_ids: ['cam'], health: {}, control: {recognition_enabled: true}};
  const react = {useState: value => { const slot = index++; if (value === false && firstBoolean) { value = true; firstBoolean = false; } states[slot] = value; return [value, next => { states[slot] = next; }]; }, useEffect: effect => effects.push(effect), useCallback: callback => callback, useRef: () => ({current: null})};
  const component = moduleFrom('src/components/PiPanel.tsx', {'react': react, 'react/jsx-runtime': {jsx: () => null, jsxs: () => null}, 'firebase/database': {}, './piStreamLifecycle': {}, '../firebase': {}, '../api': {getPiStatus: async () => status, getPiAttendance: async () => [], getPiEvents: async () => {throw new Error('legacy route missing');}}});
  component.default({uid: 'admin', locale: 'en', apiOnline: false});
  effects.forEach(effect => effect());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states[0], status);
  assert.ok(states.includes(true), "event failure must preserve an enabled video stream");
  assert.ok(states.some(value => typeof value === 'string' && /legacy route missing|unavailable/i.test(value)));
});

test('saved attendance loads again on remount independently of missing event feed', async () => {
  const saved = [{attendance_id: 7, session_id: 'session', user_id: 'user', name: 'Student', student_id: 'S001', occurred_at: '2026-10-10T10:00:00Z', camera_ids: ['cam'], similarity: .95, sync_state: 'pending'}];
  let reads = 0;
  for (let mount = 0; mount < 2; mount++) {
    const states = [];
    const effects = [];
    const component = moduleFrom('src/components/PiPanel.tsx', {'react': {useState: value => {const slot = states.length; states.push(value); return [value, next => {states[slot] = next;}];}, useEffect: effect => effects.push(effect), useCallback: callback => callback}, 'react/jsx-runtime': {jsx: () => null, jsxs: () => null}, 'firebase/database': {}, './piStreamLifecycle': {}, '../firebase': {}, '../api': {getPiStatus: async () => ({camera_ids: []}), getPiEvents: async () => {throw new Error('missing');}, getPiAttendance: async () => {reads++; return saved;}}});
    component.default({uid: 'admin', locale: 'en'});
    effects.forEach(effect => effect());
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(states.includes(saved));
  }
  assert.equal(reads, 2);
});

test('saved attendance CSV contains stable record fields and cloud sync state', () => {
  const component = moduleFrom('src/components/PiPanel.tsx', {'react': {}, 'react/jsx-runtime': {}, 'firebase/database': {}, './piStreamLifecycle': {}, '../firebase': {}, '../api': {}});
  const csv = component.piAttendanceCsv([{attendance_id: 7, session_id: 'session', user_id: 'user', name: 'Student, "A"', student_id: 'S001', occurred_at: '2026-10-10T10:00:00Z', camera_ids: ['cam1', 'cam2'], similarity: .95, sync_state: 'pending'}]);
  assert.match(csv, /attendance_id,session_id,name,student_id,user_id,occurred_at,camera_ids,similarity,sync_state/);
  assert.match(csv, /"Student, ""A"""/);
  assert.match(csv, /"cam1;cam2","0.95","pending"/);
});

test('Recog presence uses a currently permitted attendance enum', () => {
  const shared = moduleFrom('src/dashboardShared.tsx', {'react/jsx-runtime': {} });
  assert.equal(shared.presenceTab('recog'), 'attendance');
  assert.equal(shared.presenceTab('admin'), 'admin');
});

test('persisted admin Pi tab waits for role resolution and rejects confirmed viewers', () => {
  const shared = moduleFrom('src/dashboardShared.tsx', {'react/jsx-runtime': {} });
  assert.equal(shared.shouldResetTab('recog', false, false), false);
  assert.equal(shared.shouldResetTab('recog', true, true), false);
  assert.equal(shared.shouldResetTab('recog', false, true), true);
  assert.equal(shared.shouldResetTab('attendance', false, true), false);
});
