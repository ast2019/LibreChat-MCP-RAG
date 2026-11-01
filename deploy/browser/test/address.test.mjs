import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPublicAddress, readWebUrl } from '../src/address.mjs';
import { resolvePublic } from '../src/egress.mjs';

test('private, shared and reserved addresses are refused', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.17.0.2',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
    '2002:a00:1::1',
    'not-an-ip',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test('public addresses pass', () => {
  for (const address of [
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '93.184.216.34',
    '2606:4700:4700::1111',
  ]) {
    assert.equal(isPublicAddress(address), true, address);
  }
  /* IPv4 inside IPv6 is refused in every spelling, public or not. */
  for (const address of [
    '::ffff:8.8.8.8',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:10.0.0.1',
    '::127.0.0.1',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test('only http and https addresses open', () => {
  assert.equal(readWebUrl('https://www.digikala.com/').hostname, 'www.digikala.com');
  for (const value of [
    'file:///etc/passwd',
    'chrome://settings',
    'javascript:alert(1)',
    'ftp://x',
    '',
    'نه',
  ]) {
    assert.throws(() => readWebUrl(value), { code: 'invalid_url' }, value);
  }
});

test('a name with any private record is refused, even beside a public one', async () => {
  const lookup = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }];
  await assert.rejects(resolvePublic('mixed.example', { lookup }), { code: 'blocked_address' });
  const publicOnly = async () => [{ address: '93.184.216.34' }];
  assert.equal(await resolvePublic('ok.example', { lookup: publicOnly }), '93.184.216.34');
  await assert.rejects(resolvePublic('[::1]'), { code: 'blocked_address' });
  await assert.rejects(resolvePublic('169.254.169.254'), { code: 'blocked_address' });
});
