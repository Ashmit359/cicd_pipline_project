const test = require('node:test');
const assert = require('node:assert');
const app = require('./server');

test('GET /health returns ok', async () => {
  const server = app.listen(0);
  const { port } = /** @type {import('net').AddressInfo} */ (server.address());
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  const body = await res.json();
  server.close();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.status, 'ok');
});
