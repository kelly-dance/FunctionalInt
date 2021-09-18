import { readFile } from './tools.ts';
import { parseAndCompile } from './mod.ts';
import * as int from './intcode.ts';

if(!Deno.args.length) Deno.exit();
const code = readFile(Deno.args[0]);
const prog = parseAndCompile(code);
if(Deno.args.length >= 2) Deno.writeTextFileSync(Deno.args[1], prog.join(','));
int.run(int.prepareState(prog), int.terminal);
