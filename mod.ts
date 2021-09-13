import * as int from './intcode.ts';
import { parse } from './parser.ts';
import { ops, abs, stack, addLabel, finalize, resolveRef, addArgs } from './macros.ts';
import * as AST from './AST.ts';
import { FintTypes, CompilationContext, CompileData, locs, builtinScope } from './typesConstansts.ts';
import { readFile } from './tools.ts';
import { builtins, internalBuiltIns } from './builtins.ts';

if(!Deno.args.length) Deno.exit();
const code = readFile(Deno.args[0]);

const ast = parse(code);

// console.log(Deno.inspect(ast, {
//   depth: 100,
//   colors: true,
// }));

const compile = (ast: AST.FintAssignment[]): bigint[] => {
  // add builtins to the scope and assign labels
  const builtinLocations: symbol[] = [];
  for(const builtin of builtins){
    builtinScope.add(builtin.name);
    builtinLocations.push(builtin.loc);
  }
  const builtinsData = builtins.flatMap(builtin => builtin.impl());

  // used to write compile time variables without splitting up the currently block
  const writeToMemory: CompileData[] = [];

  const prog = [
    // Move stack pointer to end of program
    ...ops.rebase(addArgs(abs(locs.stackBegin), abs(2))),

    // Process assignments
    ...ast.flatMap(assignemnt => {
      const globalContext: CompilationContext = {
        meta: assignemnt.meta,
        scope: assignemnt.scope.parent!,
      }

      const { immediate, memory } = assignemnt.compile(globalContext);
      writeToMemory.push(...memory);

      return [
        ...immediate, // inlines the code to execute the assignment
        // return value should be at stack+0
        // *should* write the return value into the active scope correctly
        ...ops.copy(stack(0), resolveRef(assignemnt.ref.name), globalContext), 
      ];
    }),

    // end of program
    ...ops.exit(),

    // built in procedures. not formatted as variables or for direct access
    ...internalBuiltIns,

    // compile time allocated vaiables
    ...builtinsData, // built in definitions
    addLabel(FintTypes.Scope, locs.builtinScopeSym), 0, ...builtinLocations, // builtin scope object
    addLabel(FintTypes.Scope, locs.globalScopeSym), locs.builtinScopeSym, ...ast.map(() => 0), // global scope object
    ...writeToMemory, // other compile time variables

    // ram position counter 
    addLabel(locs.ramBegin, locs.ramPointer),

    // start of the stack is actually 2 past this
    // this way the global scope object is already at scope-2 when the program starts
    addLabel(locs.globalScopeSym, locs.stackBegin), 
  ];
  return finalize(prog);
}

const compiled = compile(ast);
console.log(`Generated program size:`, compiled.length);

if(Deno.args.length >= 2) Deno.writeTextFileSync(Deno.args[1], compiled.join(','))

const state = int.prepareState(compiled);
int.run(state, int.terminal, false);
