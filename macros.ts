import { CompilationContext, Reducible, CompileData, HangingLabel, locs } from './typesConstansts.ts';

export enum OpMode {
  pointer = 0,
  absolute = 1,
  stack = 2,
}

export type Arg = (context?: CompilationContext) => {
  constant: boolean,
  value: CompileData,
  insert: CompileData[],
  mode: OpMode,
};

export const addReducible = (dependents: CompileData[]): Reducible => {
  return new Reducible(dependents, (vals) => vals.reduce((a,n) => a + n, 0n), []);
}

export const addLabel = (data: CompileData, label?: symbol): CompileData => {
  if(!label) return data;
  if(typeof data === 'object'){
    data.labels.push(label);
    return data;
  }
  return {
    value: data,
    labels: [label],
  }
}

export const formatCall = (context: CompilationContext | undefined, opCode: bigint, args: Arg[], tag?: symbol): CompileData[] => {
  const evaluatedArgs = args.map((arg, i) => {
    const evaled = arg(context);
    opCode += BigInt(evaled.mode) * 10n ** BigInt(i+2);
    return evaled;
  });
  return [
    ...evaluatedArgs.flatMap(arg => arg.insert),
    tag ? { value: opCode, labels: [tag] } : opCode,
    ...evaluatedArgs.flatMap(arg => arg.value),
  ];
}

export const ptr = (value: CompileData, tag?: symbol): Arg => () => ({value: addLabel(value, tag), insert: [], mode: OpMode.pointer, constant: true });
export const abs = (value: CompileData, tag?: symbol): Arg => () => ({value: addLabel(value, tag), insert: [], mode: OpMode.absolute, constant: true });
export const stack = (value: CompileData, tag?: symbol): Arg => () => ({value: addLabel(value, tag), insert: [], mode: OpMode.stack, constant: true });

/**
 * The adds to the literal value, be it an address or stack position
 * mode of the second arg is preserved
 */
export const addArgs = (offset: Arg, arg: Arg): Arg => context => {
  const tag = Symbol('addConstantTarget');
  const {value, insert, mode, constant} = arg(context);

  // collapse at compile time
  // both args are constant and the offset is absolute so there there is no pointer that needs to be followed to resolve it
  const evaledOffset = offset(context);
  if(constant && evaledOffset.constant && evaledOffset.mode === OpMode.absolute) {
    return {
      constant: true,
      value: addReducible([value, evaledOffset.value]),
      insert: [
        // I honestly cant think of a situation where constant operations have code inserted
        // it would feel weird to exclude this though
        // maybe if I pack side effects into inserted code it could make sense
        // could be useful for debugging
        ...evaledOffset.insert,
        ...insert,
      ],
      mode,
    }
  }

  return {
    constant: false,
    value: addLabel(0, tag),
    insert: [
      ...insert,
      ...ops.add(abs(value), offset, ptr(tag), context)
    ],
    mode,
  }
}

/**
 * Arg to resolve must be type pointer!
 * example: if arg is ptr(10) it returns the value in address 10 as abs
 * always returns abs mode
 */
export const resolvePtr = (arg: Arg): Arg => context => {
  const tag = Symbol('resolvePtrTarget');
  const {value, insert, mode} = arg(context);
  if(mode !== OpMode.pointer) throw new Error('Cannot resolve as pointer!');
  return {
    constant: false,
    value: addLabel(0, tag),
    insert: [
      ...insert,
      ...ops.copy(ptr(value), ptr(tag), context),
    ],
    mode: OpMode.absolute,
  }
}

/**
 * takes an absolute arg and returns a pointer arg
 */
export const absToPtr = (arg: Arg): Arg => context => {
  const {value, insert, mode, constant} = arg(context);
  if(mode === OpMode.pointer) throw new Error('Cannot change pointer to pointer!');
  return { constant, value, insert, mode: OpMode.pointer }
}

/**
 * takes a pointer arg and returns an absolute arg
 */
 export const ptrToAbs = (arg: Arg): Arg => context => {
  const {value, insert, mode, constant} = arg(context);
  if(mode === OpMode.absolute) throw new Error('Cannot change absolute to absolute!');
  return { constant, value, insert, mode: OpMode.absolute }
}

/**
 * takes an absolute arg and returns a pointer arg
 */
 export const stackToPtr = (arg: Arg): Arg => context => {
  const {value, insert, mode, constant} = arg(context);
  if(mode !== OpMode.stack) throw new Error('Cannot change not stack to pointer');
  const returnLoc = Symbol('stackToPtrTarget');
  return {
    constant: false, 
    value: addLabel(0, returnLoc),
    insert: ops.copy(stack(value), ptr(returnLoc), context),
    mode: OpMode.pointer,
  }
}

/**
 * given a string this returns the location of the variable within the scope as a pointer
 */
export const resolveRef = (ref: string, scopePos: number = -2): Arg => context => {
  if(!context) throw new Error('Context required for this argument');
  const location = context.scope.get(ref);
  if(!location) {
    console.log(ref, context.scope)
    throw new Error(`Cannot locate reference "${ref}" at ${context.meta.line}:${context.meta.column}`);
  }
  if('location' in location) {
    // this reduces to a constant
    return absToPtr(addArgs(abs(location.location), abs(location.forward + 1)))(context);
  }
  const {up, forward} = location;
  const returnTo = Symbol('resolveRefTarget');
  return {
    constant: false,
    value: addLabel(0, returnTo), // labeled for that it can be used to store temporary values
    insert: [
      ...ops.copy(stack(scopePos), ptr(returnTo), context), // copy scope pointer into return location
      ...new Array(up).fill(0).flatMap(() => { // repeat to climb to parent scopes
        // return ops.copy(absToPtr(addArgs(ptr(returnTo), abs(1))), ptr(returnTo))
        return ops.copy(absToPtr(resolvePtr(ptr(returnTo))), ptr(returnTo))
      }),
      ...ops.copy(addArgs(ptr(returnTo), abs(1 + forward)), ptr(returnTo)), // move forward and land on the pointer to the desired value
    ],
    mode: OpMode.pointer,
  }
}

export const ops = {
  add: (a: Arg, b: Arg, out: Arg, context?: CompilationContext, tag?: symbol): CompileData[] => formatCall(context, 1n, [a,b,out], tag),
  addTo: (a: Arg, out: Arg, context?: CompilationContext, tag?: symbol): CompileData[] => {
    if(Math.random() < 0.5) return ops.add(a, out, out, context, tag);
    return ops.add(out, a, out, context, tag);
  },
  mult: (a: Arg, b: Arg, out: Arg, context?: CompilationContext, tag?: symbol): CompileData[] => formatCall(context, 2n, [a,b,out], tag),
  copy: (from: Arg, to: Arg, context?: CompilationContext, tag?: symbol): CompileData[] => {
    const x = Math.random();
    if(x < 0.25) return ops.mult(from, abs(1), to, context, tag);
    if(x < 0.5) return ops.mult(abs(1), from, to, context, tag);
    if(x < 0.75) return ops.add(from, abs(0), to, context, tag);
    return ops.add(abs(0), from, to, context, tag);
  },
  read: (out: Arg, context?: CompilationContext, tag?: symbol): CompileData[] => formatCall(context, 3n, [out], tag),
  write: (val: Arg, context?: CompilationContext, tag?: symbol): CompileData[] => formatCall(context, 4n, [val], tag),
  jt: (val: Arg, to: Arg, context?: CompilationContext, tag?: symbol): CompileData[] => formatCall(context, 5n, [val, to], tag),
  jump: (to: Arg, context?: CompilationContext, tag?: symbol): CompileData[] => {
    if(Math.random() < 0.66) return ops.jt(abs(Math.floor(Math.random()*999)+1), to, context, tag);
    return ops.jf(abs(0), to, context, tag);
  },
  jf: (val: Arg, to: Arg, context?: CompilationContext, tag?: symbol): CompileData[] => formatCall(context, 6n, [val, to], tag),
  lt: (a: Arg, b: Arg, out: Arg, context?: CompilationContext, tag?: symbol): CompileData[] => formatCall(context, 7n, [a,b,out], tag),
  eq: (a: Arg, b: Arg, out: Arg, context?: CompilationContext, tag?: symbol): CompileData[] => formatCall(context, 8n, [a,b,out], tag),
  rebase: (val: Arg, context?: CompilationContext, tag?: symbol): CompileData[] => formatCall(context, 9n, [val], tag),
  moveStack: (val: number | bigint, context?: CompilationContext, tag?: symbol): CompileData[] => formatCall(context, 9n, [abs(val)], tag),
  exit: (tag?: symbol): CompileData[] => [addLabel(99, tag)],
}

export const writeToRam = (val: Arg, context?: CompilationContext): CompileData[] => {
  return [
    ...ops.copy(val, absToPtr(resolvePtr(ptr(locs.ramPointer))), context),
    ...ops.addTo(abs(1), ptr(locs.ramPointer), context),
  ];
}

export const finalize = (prog: CompileData[]): bigint[] => {
  // collapse hanging labels
  const newProg: CompileData[] = [];
  for(let i = 0; i < prog.length; i++){
    const entry = prog[i];
    if(typeof entry === 'object' && entry instanceof HangingLabel){
      prog[i+1] = addLabel(prog[i+1], entry.labels[0]);

    }
    else newProg.push(entry);
  }
  // newProg.forEach((entry, i) => {
  //   console.log(i, entry)
  // })
  // record position of symbols
  const positions = new Map<symbol, bigint>();
  for(let i = 0; i < newProg.length; i++){
    const entry = newProg[i];
    if(typeof entry === 'object'){
      for(const label of entry.labels) positions.set(label, BigInt(i));
    }
  }
  const processCompileData = (entry: CompileData) => {
    let data: symbol | bigint | number;
    if(typeof entry === 'object'){
      if(entry instanceof Reducible) data = entry.reducer(entry.dependents.map(processCompileData));
      else if(entry instanceof HangingLabel) throw 'never'; // hanging label was already removed
      else data = entry.value;
    }else data = entry;
    if(typeof data === 'bigint') return data;
    if(typeof data === 'number') return BigInt(data);
    if(!positions.has(data)) throw new Error(`Unlocated symbol pointer! ${data.toString()}`);
    return positions.get(data)!;
  }
  return newProg.map(processCompileData)
}
