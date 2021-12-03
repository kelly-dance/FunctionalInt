import { readFile } from '../../../../tools.ts';
import * as int from '../../../../intcode.ts';
import { parseAndCompile } from '../../../../mod.ts';

const inp = readFile('./samples/AoC/2021/01/input').split('\n').map(l => parseInt(l));

const code = readFile('./samples/AoC/2021/01/solution2.fint');
const prog = parseAndCompile(code);
Deno.writeTextFileSync('./out.int', prog.program.join(','));
int.scriptManager(int.prepareState(prog.program), function*(send, rec){
  yield send(BigInt(inp.length));
  for(let i = 0; i < inp.length; i++) yield send(BigInt(inp[i]));
  while(true) console.log(yield rec());
});
