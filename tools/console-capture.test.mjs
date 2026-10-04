import assert from 'node:assert/strict';
import { decodeConsoleEntities, parseBotLogLine } from './console-utils.mjs';

assert.equal(decodeConsoleEntities('{&#x22;a&#x22;:1}'), '{"a":1}');
assert.deepEqual(parseBotLogLine('[BOTLOG]{&#x22;v&#x22;:&#x22;0.2.9-node18&#x22;,&#x22;tick&#x22;:123,&#x22;code&#x22;:&#x22;BOT_HEARTBEAT&#x22;}'), {
  v: '0.2.9-node18', tick: 123, code: 'BOT_HEARTBEAT'
});
assert.deepEqual(parseBotLogLine('[prefix] [BOTLOG]{"tick":456,"code":"STATUS_SNAPSHOT"}'), {
  tick: 456, code: 'STATUS_SNAPSHOT'
});
assert.equal(parseBotLogLine('ordinary line'), null);
console.log('console capture tests passed');
