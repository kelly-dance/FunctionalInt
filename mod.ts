import * as int from './intcode.ts';
import { parse } from './parser.ts';
import { ops, abs, stack, addLabel, finalize, resolveRef, addArgs } from './macros.ts';
import * as AST from './AST.ts';
import { CompilationContext, CompileData, locs, builtinScope } from './typesConstansts.ts';
import { readFile } from './tools.ts';
import { builtins, internalBuiltIns, BuiltIn } from './builtins.ts';

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
  const check = (b: BuiltIn): boolean => {
    if(AST.FintVariableReference.instances.some(ref => ref.name === b.name)) return true;
    return builtins.some(dep => dep.dependsOn.includes(b) && check(dep));
  }
  const inUse = builtins.filter(check);
  for(const builtin of inUse){
    builtinScope.add(builtin.name);
    builtinLocations.push(builtin.loc);
  }
  const builtinsData = inUse.flatMap(builtin => {
    const impl = builtin.impl();
    console.log(builtin.name, impl.length);
    return impl;
  });

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
    addLabel(0, locs.builtinScopeSym), ...builtinLocations, // builtin scope object
    addLabel(locs.builtinScopeSym, locs.globalScopeSym), ...ast.map(() => 0), // global scope object
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
try{
  int.run(state, int.terminal, false);
}catch(e){
  console.error(e);
}

// for(const key of state.memory.keys()){
//   console.log(key, state.memory.get(key))
// }
