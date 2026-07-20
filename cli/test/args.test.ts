import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgv, parseChannels } from '../src/core/args.ts';

test('empty argv defaults to install with interactiveDefault', () => {
  const args = parseArgv([]);
  assert.equal(args.command, 'install');
  assert.equal(args.interactiveDefault, true);
  assert.equal(args.skipDocker, false);
  assert.equal(args.force, false);
  assert.equal(args.pre, false);
  assert.equal(args.dev, false);
  assert.equal(args.yes, false);
  assert.equal(args.purge, false);
  assert.equal(args.help, false);
  assert.equal(args.explicitBaseUrl, false);
  assert.equal(args.explicitApiToken, false);
  assert.equal(args.baseUrl, undefined);
  assert.equal(args.apiToken, undefined);
  assert.equal(args.channels, undefined);
  assert.equal(args.lang, undefined);
});

test('connect is an alias for install', () => {
  const args = parseArgv(['connect']);
  assert.equal(args.command, 'install');
  assert.equal(args.interactiveDefault, false);
});

test('explicit install command is not interactiveDefault', () => {
  const args = parseArgv(['install']);
  assert.equal(args.command, 'install');
  assert.equal(args.interactiveDefault, false);
});

test('update/uninstall/status/help commands', () => {
  assert.equal(parseArgv(['update']).command, 'update');
  assert.equal(parseArgv(['uninstall']).command, 'uninstall');
  assert.equal(parseArgv(['status']).command, 'status');
  assert.equal(parseArgv(['help']).command, 'help');
});

test('unknown command throws', () => {
  assert.throws(() => parseArgv(['nope']), /unknown command/i);
});

test('no command with flags still defaults to install without interactiveDefault', () => {
  const args = parseArgv(['--pre']);
  assert.equal(args.command, 'install');
  assert.equal(args.interactiveDefault, false);
  assert.equal(args.pre, true);
});

test('parses value flags and explicit markers', () => {
  const args = parseArgv([
    'install',
    '--base-url',
    'http://example.com/',
    '--api-token',
    'lm_secret',
    '--channels',
    'pi,opencode',
    '--lang',
    'zh',
  ]);
  assert.equal(args.baseUrl, 'http://example.com/');
  assert.equal(args.apiToken, 'lm_secret');
  assert.deepEqual(args.channels, ['pi', 'opencode']);
  assert.equal(args.lang, 'zh');
  assert.equal(args.explicitBaseUrl, true);
  assert.equal(args.explicitApiToken, true);
});

test('parses boolean flags including short -y', () => {
  const args = parseArgv([
    'uninstall',
    '--skip-docker',
    '--force',
    '--pre',
    '--dev',
    '--yes',
    '--purge',
    '-y',
    '--help',
  ]);
  assert.equal(args.command, 'uninstall');
  assert.equal(args.skipDocker, true);
  assert.equal(args.force, true);
  assert.equal(args.pre, true);
  assert.equal(args.dev, true);
  assert.equal(args.yes, true);
  assert.equal(args.purge, true);
  assert.equal(args.help, true);
});

test('missing value for --base-url throws', () => {
  assert.throws(() => parseArgv(['install', '--base-url']), /--base-url/i);
});

test('missing value for --api-token throws', () => {
  assert.throws(() => parseArgv(['install', '--api-token']), /--api-token/i);
});

test('missing value for --channels throws', () => {
  assert.throws(() => parseArgv(['install', '--channels']), /--channels/i);
});

test('missing value for --lang throws', () => {
  assert.throws(() => parseArgv(['install', '--lang']), /--lang/i);
});

test('invalid --lang throws', () => {
  assert.throws(() => parseArgv(['install', '--lang', 'fr']), /lang/i);
});

test('unknown flag throws', () => {
  assert.throws(() => parseArgv(['install', '--nope']), /unknown/i);
});

test('parseChannels validates against ALL_CHANNELS', () => {
  assert.deepEqual(parseChannels('claudecode, pi ,opencode'), [
    'claudecode',
    'pi',
    'opencode',
  ]);
  assert.throws(() => parseChannels('pi,bogus'), /unknown channel/i);
});

test('-h sets help', () => {
  const args = parseArgv(['-h']);
  assert.equal(args.help, true);
  assert.equal(args.command, 'install');
});
