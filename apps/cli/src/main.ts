#!/usr/bin/env -S tsx
/**
 * The `gapos` CLI entrypoint (GAP-025). Builds the server context from env and dispatches one
 * command. Interactive prompts read stdin when the terminal is a TTY; flags make the same
 * commands scriptable.
 */

import { getServerContext } from '../../web/src/server/bootstrap.js';
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

const out = (line: string): void => {
  // The CLI's stdout is its interface; lint's no-console exception covers warn/error only,
  // so the CLI writes through process.stdout explicitly.
  process.stdout.write(`${line}\n`);
};

const isTty = process.stdin.isTTY === true;

const main = async (): Promise<void> => {
  // The same env-driven bootstrap the web and worker processes use: Postgres when
  // GAPOS_DATABASE_URL is set, in-memory otherwise (with a loud warning).
  const context = await getServerContext();

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
