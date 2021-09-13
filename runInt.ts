// this file is just used to run a compiled intcode program
// deno run --allow-read ./path/to/file
import * as int from './intcode.ts';
import { readFile } from './tools.ts';

const program = readFile(Deno.args[0]).split(',').map(s => parseInt(s))

int.run(int.prepareState(program), int.terminal, false);
