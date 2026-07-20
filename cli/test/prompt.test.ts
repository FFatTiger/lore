import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { createTTYPrompt } from '../src/ui/prompt.ts';

function mockIO(answers: string[]) {
  const input = new PassThrough();
  const output = new PassThrough();
  let i = 0;
  // Feed answers after interface starts reading
  const pushNext = () => {
    if (i < answers.length) {
      input.write(`${answers[i++]}\n`);
    }
  };
  output.on('data', () => {
    // each question writes to output; feed next answer shortly
    setImmediate(pushNext);
  });
  // kick first answer
  setImmediate(pushNext);
  return { input, output };
}

test('TTY prompt selectMode docker on 2', async () => {
  const io = mockIO(['2']);
  const prompt = createTTYPrompt({ lang: 'en', io });
  const mode = await prompt.selectMode();
  assert.equal(mode, 'docker');
});

test('TTY prompt pickChannels parses list', async () => {
  const io = mockIO(['pi,opencode']);
  const prompt = createTTYPrompt({ lang: 'en', io });
  const channels = await prompt.pickChannels(['pi']);
  assert.deepEqual(channels, ['pi', 'opencode']);
});

test('TTY prompt confirm no aborts', async () => {
  const io = mockIO(['n']);
  const prompt = createTTYPrompt({ lang: 'en', io });
  const ok = await prompt.confirm('summary');
  assert.equal(ok, false);
});
