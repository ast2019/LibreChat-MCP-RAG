import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPublicAddress } from '../src/address.mjs';

test('private, reserved and IPv4-in-IPv6 addresses are refused; public ones pass', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ['8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

/* IPv4-translated (::ffff:0:0:0/96) and IPv4-compatible (::/96) addresses carry an IPv4
   address the same way the mapped form does, so they are refused in every spelling. */
test('IPv4-translated and IPv4-compatible IPv6 addresses are refused', () => {
  for (const address of [
    '::ffff:0:7f00:1',
    '::ffff:0:127.0.0.1',
    '0:0:0:0:ffff:0:a00:1',
    '::FFFF:0:A9FE:A9FE',
    '::ffff:0:808:808',
    '::7f00:1',
    '::a9fe:a9fe',
    '::808:808',
    '0:0:0:0:0:0:8.8.8.8',
    '::0:0:7f00:1',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ['::1:0:0:1', '1::7f00:1', '::ffff:1:0:7f00:1', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(address), true, address);
  }
});
