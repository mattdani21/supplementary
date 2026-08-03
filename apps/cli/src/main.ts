#!/usr/bin/env -S tsx
/**
 * The `gapos` CLI entrypoint (GAP-025). Builds the server context from env and dispatches one
 * command. Interactive prompts read stdin when the terminal is a TTY; flags make the same
 * commands scriptable.
 */

import { createServerContext } from '../../web/src/server/context.js';
import { createLogger } from '@gapos/observability';
import {
  compileCommand,
  gapList,
  gapNew,
  gapShow,
  masteryCommand,
  planCommand,
  sourceAdd,
  studyCommand,
  usage,
} from './commands.js';
import { createInterface } from 'node:readline/promises';

const out = (line: string): void => console.log(line);

const isTty = process.stdin.isTTY === true;

const main = async (): Promise<void> => {
  const logger = createLogger({}, { level: 'warn' });
  const context = createServerContext({ logLevel: 'warn' });

  if (!process.env.GAPOS_DATABASE_URL) {
    logger.warn(
      'GAPOS_DATABASE_URL is not set; using in-memory repositories. Data does not survive the process.',
    );
  }

  const rl = isTty ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const io = {
    out,
    prompt: rl ? async (question: string) => rl.question(question) : undefined,
  };

  const [command, ...args] = process.argv.slice(2);
  try {
    switch (command) {
      case 'gap':
        if (args[0] === 'new') await gapNew(context, args.slice(1), io);
        else if (args[0] === 'list') await gapList(context, [], io);
        else await gapShow(context, args, io);
        break;
      case 'source':
        await sourceAdd(context, args.slice(1), io);
        break;
      case 'compile':
        await compileCommand(context, args, io);
        break;
      case 'plan':
        await planCommand(context, args, io);
        break;
      case 'study':
        await studyCommand(context, args, io);
        break;
      case 'mastery':
        await masteryCommand(context, args, io);
        break;
      default:
        usage(io);
    }
  } finally {
    rl?.close();
  }
};

void main();
