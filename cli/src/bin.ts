#!/usr/bin/env node
import { run } from './cli.js';
import { isInteractiveAbort } from './ui/prompt.js';

let code: number;
try {
  code = await run(process.argv.slice(2));
} catch (error) {
  if (isInteractiveAbort(error)) {
    code = 130;
  } else {
    throw error;
  }
}
process.exit(code);
