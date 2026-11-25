#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { checkName, NAME, UsageError } from './case.ts';
import { doctor } from './doctor.ts';
import { record } from './record.ts';
import { hidden } from './redact.ts';
import { replay } from './replay.ts';

const usage = `Usage: angular-anything <command>

Commands:
  doctor                                               Check Node, Playwright and Chromium
  record <suite> --source <name> --url <original-url>  Record the original
  replay <suite> --source <name> --url <port-url> [--original-url <original-url>] [--redact]
                                                       Replay against the port and write a report
  gate   <suite> --source <name> --url <port-url> [--original-url <original-url>] [--redact]
         [--original-source <dir> --port-source <dir>]
                                                       Replay, check the lock, exit 1 on a mismatch
  drift  <suite> --source <name> --url <port-url> --original-url <original-url>
                                                       Gate both, say whether the original changed or the port regressed

Cases are read from cases/<suite>, recordings are kept in recordings/<source>,
reports are written to reports/<source>, all below the current directory.
With --redact, replay and gate print and write shapes only (where, types, lengths, hashes),
never recorded, typed or page values, and no screenshots.
With --original-source and --port-source, gate also fails a port whose source holds 3 or more
recorded values that the original source does not hold, or names the recording files.
A query in the url, such as ?bug=aria, is added to every page the cases open.
Sizes, positions and screenshots are compared only with --original-url: the original
is run again in the same command, checked against its recording, and compared with the port.`;

async function verify(command: 'record' | 'replay' | 'gate' | 'drift', args: string[]): Promise<number> {
  try {
    const flags = {
      source: { type: 'string', multiple: true },
      url: { type: 'string', multiple: true },
      'original-url': { type: 'string', multiple: true },
      redact: { type: 'boolean' },
      'original-source': { type: 'string', multiple: true },
      'port-source': { type: 'string', multiple: true },
    } as const;
    if (command !== 'record') {
      for (const named of parseArgs({ args, options: flags, allowPositionals: true, strict: false }).values.source ?? []) {
        if (typeof named === 'string' && NAME.test(named)) {
          await rm(join(process.cwd(), 'reports', named), { recursive: true, force: true });
        }
      }
    }
    const { values, positionals } = parseArgs({ args, options: flags, allowPositionals: true });
    for (const name of ['source', 'url', 'original-url', 'original-source', 'port-source'] as const) {
      if ((values[name]?.length ?? 0) > 1) throw new UsageError(`--${name} is given twice`);
    }
    if (command === 'record' && values['original-url']) throw new UsageError('record takes no --original-url');
    if ((command === 'record' || command === 'drift') && values.redact) throw new UsageError(`${command} takes no --redact`);
    if (command === 'drift' && !values['original-url']) throw new UsageError('drift needs --original-url <original-url>');
    const [originalSource] = values['original-source'] ?? [];
    const [portSource] = values['port-source'] ?? [];
    if (command !== 'gate' && (originalSource !== undefined || portSource !== undefined)) {
      throw new UsageError('only gate takes --original-source and --port-source');
    }
    if (!originalSource !== !portSource) throw new UsageError('give both --original-source and --port-source, or neither');
    const sources = originalSource && portSource ? { originalSource, portSource } : undefined;
    const [source] = values.source ?? [];
    const [given] = values.url ?? [];
    if (positionals.length !== 1 || !source || !given) {
      throw new UsageError(`${command} needs one <suite>, --source <name> and --url <url>`);
    }
    const address = (name: string, text: string) => {
      const parsed = URL.parse(text);
      if (parsed && (parsed.username !== '' || parsed.password !== '')) {
        throw new UsageError(`--${name} must not hold a user name or a password`);
      }
      if (!parsed || !/^https?:$/.test(parsed.protocol) || parsed.pathname !== '/' || parsed.hash) {
        throw new UsageError(`--${name} must be an http or https address without a path, such as http://localhost:4104`);
      }
      return parsed;
    };
    const url = address('url', given);
    const [originalAddress] = values['original-url'] ?? [];
    const original = originalAddress === undefined ? undefined : address('original-url', originalAddress);
    const options = { root: process.cwd(), suite: positionals[0], source: checkName('source', source), url };
    if (command === 'record') return await record(options);
    const drift = command === 'drift';
    return await replay({ ...options, gate: drift || command === 'gate', original, redact: values.redact, drift, sources });
  } catch (error) {
    const { code, message } = error as Error & { code?: string };
    if (error instanceof UsageError || code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`${message}\n\n${usage}`);
      return 2;
    }
    console.error(`${command} failed: ${args.some((arg) => arg.startsWith('--redact')) ? hidden(message) : message}`);
    return 1;
  }
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'doctor':
    process.exitCode = await doctor();
    break;
  case 'record':
  case 'replay':
  case 'gate':
  case 'drift':
    process.exitCode = await verify(command, args);
    break;
  case '--help':
  case '-h':
    console.log(usage);
    break;
  default:
    console.error(usage);
    process.exitCode = 2;
}
