const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-stream-test-'));
let code = 1;
try {
  const compiled = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), path.join(root, 'src/components/piStreamLifecycle.ts'), '--outDir', output, '--module', 'commonjs', '--target', 'ES2020', '--skipLibCheck'], { stdio: 'inherit' });
  if (compiled.status === 0) {
    const tested = spawnSync(process.execPath, ['--test', path.join(root, 'tests/pi-stream-lifecycle.test.cjs')], { stdio: 'inherit', env: { ...process.env, PI_STREAM_TEST_MODULE: path.join(output, 'piStreamLifecycle.js') } });
    code = tested.status ?? 1;
  }
} finally { fs.rmSync(output, { recursive: true, force: true }); }
process.exit(code);
