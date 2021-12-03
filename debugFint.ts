import { readFile } from './tools.ts';
import { parseAndCompile } from './mod.ts';
import * as int from './intcode.ts';

if(!Deno.args.length) Deno.exit();
const code = readFile(Deno.args[0]);
const prog = parseAndCompile(code);
if(Deno.args.length >= 2) Deno.writeTextFileSync(Deno.args[1], prog.program.join(','));
const state = int.prepareState(prog.program);
int.debugRun(state, int.terminal, {
  breakpoints: prog.breakpoints,
  labels: prog.labels,
});
const mem = [...state.memory.entries()].sort(([a],[b]) => Number(a - b));
const dump = mem.map(([a, v]) => `${a}: ${v} ${prog.labels.get(a)?.join(' ')}`).join('\n');
Deno.writeTextFileSync('memdump.txt', dump);
