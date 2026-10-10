const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStreamGuard } = require(process.env.PI_STREAM_TEST_MODULE);

function guardFixture() {
  let queued;
  let delay;
  const messages = [];
  let stopped = 0;
  let cancelled = 0;
  const guard = createStreamGuard({ vi: false, report: message => messages.push(message), stop: () => { stopped++; guard.dispose(); }, schedule: (callback, milliseconds) => { queued = callback; delay = milliseconds; return 7; }, cancel: () => { cancelled++; queued = undefined; } });
  return { guard, messages, stopped: () => stopped, cancelled: () => cancelled, delay: () => delay, expire: () => queued?.() };
}

for (const value of [null, { state: 'error', error: 'secret-server-path' }, { state: 'revoked' }, { state: 'closed' }]) {
  test(`terminal session ${JSON.stringify(value)} stops immediately without leaking error`, () => {
    const fixture = guardFixture();
    fixture.guard.arm();
    assert.equal(fixture.guard.session(value), false);
    assert.equal(fixture.stopped(), 1);
    assert.equal(fixture.cancelled(), 1);
    assert.ok(fixture.messages[0]);
    assert.ok(!fixture.messages[0].includes('secret-server-path'));
    fixture.expire();
    assert.equal(fixture.stopped(), 1);
  });
}

test('capacity rejection has an actionable safe message', () => {
  const fixture = guardFixture();
  fixture.guard.session({ state: 'error', error: 'WebRTC viewer capacity reached' });
  assert.match(fixture.messages[0], /capacity/);
  assert.equal(fixture.stopped(), 1);
});

test('no answer or no connection expires and stops after 30 seconds', () => {
  const fixture = guardFixture();
  fixture.guard.arm();
  assert.equal(fixture.delay(), 30000);
  assert.equal(fixture.guard.session({ state: 'offer' }), true);
  assert.equal(fixture.guard.session({ state: 'answered', answer: { type: 'answer', sdp: 'offer' } }), true);
  fixture.expire();
  assert.equal(fixture.stopped(), 1);
  assert.match(fixture.messages[0], /30 seconds/);
});

test('connected peer cancels deadline but still responds to revoked session', () => {
  const fixture = guardFixture();
  fixture.guard.arm();
  fixture.guard.connected();
  fixture.expire();
  assert.equal(fixture.stopped(), 0);
  assert.equal(fixture.cancelled(), 1);
  fixture.guard.session({ state: 'revoked' });
  assert.equal(fixture.stopped(), 1);
});

test('dispose prevents later callbacks and clears deadline', () => {
  const fixture = guardFixture();
  fixture.guard.arm();
  fixture.guard.dispose();
  fixture.expire();
  assert.equal(fixture.guard.session(null), false);
  assert.equal(fixture.stopped(), 0);
  assert.equal(fixture.cancelled(), 1);
});
