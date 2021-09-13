import { CompileData, FintScope, FintTypes, HangingLabel, locs, CompilationContext, FintMeta, builtinScope } from './typesConstansts.ts';
import { ops, ptr, abs, stack, addLabel, resolvePtr, writeToRam, addArgs, absToPtr, resolveRef, resolveIntRefVal, writeIntToRam } from './macros.ts';

const blankMeta = new FintMeta(-1, -1, -1, true);

const none: BuiltIn = (()=>{
  const loc = Symbol('none');
  return {
    loc,
    name: '_',
    impl: () => [addLabel(FintTypes.None, loc)],
  }
})();

const makeBuiltin = (
  name: string,
  fac: (context: CompilationContext) => CompileData[]
): BuiltIn => {
  const loc = Symbol(name);
  
  return {
    loc,
    name,
    impl: () => {
      
      const def = Symbol(`${name}-def`);
    
      const localScope = new FintScope(builtinScope);
      localScope.add('arg');
      localScope.add('self');
    
      const context: CompilationContext = {
        meta: blankMeta,
        scope: localScope,
      }
      return [
        // Function Instance
        addLabel(FintTypes.FunctionInstance, loc),
        def,
        locs.builtinScopeSym,
  
        // Function Def
        addLabel(FintTypes.FunctionDef, def),
        ...ops.moveStack(2),
        ...fac(context),
        ...ops.moveStack(-2),
        ...ops.copy(stack(2), stack(0)), // copy the old stack+0 to new stack+0 as return value
        ...ops.jump(stack(1)),
      ]
    }
  }
}

const makeMultiArgBuiltin = (
  name: string,
  args: string[],
  fac: (context: CompilationContext) => CompileData[]
): BuiltIn => {

  const instanceLoc = Symbol(`${name}-inst`);

  return {
    name,
    loc: instanceLoc,
    impl: () => {
      const helper = (
        args: string[],
        parentScope: FintScope,
      ): {impl: CompileData[], loc: symbol} => {
        const selfLoc = Symbol(`${name}-${args[0]}`);
    
        const localScope = new FintScope(parentScope);
        localScope.add(args[0]);
        localScope.add(`self`);
    
        const context: CompilationContext = {
          meta: blankMeta,
          scope: localScope,
        }
    
        if(args.length === 1) return { // this is the base definition
          impl: [
            addLabel(FintTypes.FunctionDef, selfLoc),
            ...ops.moveStack(2),
      
            // body
            ...fac(context),
      
            // end of function
            ...ops.moveStack(-2),
            ...ops.copy(stack(2), stack(0)), // pointer to var
            ...ops.jump(stack(1)),
          ],
          loc: selfLoc,
        }
    
        // this is an intemediate function 
        const {impl, loc} = helper(args.slice(1), localScope); // generate sub function
        return {
          impl: [
            // Outer Function Def
            addLabel(FintTypes.FunctionDef, selfLoc),
            ...ops.moveStack(2),
    
            // create inner function instance to return
            ...ops.copy(ptr(locs.ramPointer), stack(0)),
            ...writeToRam(abs(FintTypes.FunctionInstance)), // data type
            ...writeToRam(abs(loc)), // inner function def address
            ...writeToRam(stack(-2)), // scope
    
            // end of function
            ...ops.moveStack(-2),
            ...ops.copy(stack(2), stack(0)), // pointer to var
            ...ops.jump(stack(1)),
    
            // include sub function
            ...impl,
          ],
          loc: selfLoc,
        }
      }
    
      
      const {impl, loc} = helper(args, builtinScope);

      return [
        // Root Function Instance
        addLabel(FintTypes.FunctionInstance, instanceLoc),
        loc,
        locs.builtinScopeSym,
  
        // Function impls
        ...impl,
      ]
    }
  }
}

const print = makeBuiltin('print', context => {
  return [
    ...ops.write(resolveIntRefVal('arg'), context),
    ...ops.copy(abs(none.loc), stack(0), context),
  ]
});

const input = makeBuiltin('input', context => {
  const result = Symbol(`addResult`)
  return [
    ...ops.read(ptr(result)),
    ...writeIntToRam(abs(0, result), stack(0)), // write and save location
  ]
});

const succ = makeBuiltin('succ', context => {
  const result = Symbol('succResult');
  return [
    ...ops.add(resolveIntRefVal('arg'), abs(1), ptr(result), context), // add 1
    ...writeIntToRam(abs(0, result), stack(0)), // write to memory and save location
  ]
});

const add = makeMultiArgBuiltin('add', ['a', 'b'], context => {
  const result = Symbol(`addResult`)
  return [
    ...ops.add(
      resolveIntRefVal('a'),
      resolveIntRefVal('b'),
      ptr(result),
      context
    ),
    ...writeIntToRam(abs(0, result), stack(0)), // write and save location
  ]
});

const sub = makeMultiArgBuiltin('sub', ['a', 'b'], context => {
  const result = Symbol(`subResult`)
  return [
    ...ops.mult(resolveIntRefVal('b'), abs(-1), ptr(result), context), // result = -b
    ...ops.addTo(resolveIntRefVal('a'), ptr(result), context), // result += a
    ...writeIntToRam(abs(0, result), stack(0)), // write and save location
  ]
});

const mult = makeMultiArgBuiltin('mult', ['a', 'b'], context => {
  const result = Symbol(`multResult`)
  return [
    ...ops.mult(
      resolveIntRefVal('a'),
      resolveIntRefVal('b'),
      ptr(result),
      context
    ),
    ...writeIntToRam(abs(0, result), stack(0)), // write and save location
  ]
});

const trueFn = makeMultiArgBuiltin('true', ['first', 'second'], context => {
  return ops.copy(resolveRef('first'), stack(0), context);
});

const falseFn = makeMultiArgBuiltin('false', ['first', 'second'], context => {
  return ops.copy(resolveRef('second'), stack(0), context);
});

const doFn = makeBuiltin('do', context => {
  return ops.copy(resolveRef('self'), stack(0), context);
});

const eq = makeMultiArgBuiltin('eq', ['a', 'b'], context => {
  const boolLoc = Symbol(`eqCheckLoc`);
  const trueLoc = Symbol(`eqTrueBranch`);
  const endLoc = Symbol(`eqEnd`);
  return [
    ...ops.eq(resolveIntRefVal('a'), resolveIntRefVal('b'), ptr(boolLoc), context),
    ...ops.jt(abs(0, boolLoc), abs(trueLoc)),
    
    // false branch
    ...ops.copy(abs(falseFn.loc), stack(0), context),
    ...ops.jump(abs(endLoc)),

    // true branch
    new HangingLabel(trueLoc),
    ...ops.copy(abs(trueFn.loc), stack(0), context),

    new HangingLabel(endLoc),
  ];
});

const lt = makeMultiArgBuiltin('lt', ['a', 'b'], context => {
  const boolLoc = Symbol(`eqCheckLoc`);
  const trueLoc = Symbol(`eqTrueBranch`);
  const endLoc = Symbol(`eqEnd`);
  return [
    ...ops.lt(resolveIntRefVal('a'), resolveIntRefVal('b'), ptr(boolLoc), context),
    ...ops.jt(abs(0, boolLoc), abs(trueLoc)),
    
    // false branch
    ...ops.copy(abs(falseFn.loc), stack(0), context),
    ...ops.jump(abs(endLoc)),

    // true branch
    new HangingLabel(trueLoc),
    ...ops.copy(abs(trueFn.loc), stack(0), context),

    new HangingLabel(endLoc),
  ];
});

const getFn = makeMultiArgBuiltin('get', ['pos', 'tup'], context => {
  return [
    ...ops.copy(
      addArgs(
        addArgs(resolveIntRefVal('pos'), abs(1)), // skip the data type tag
        absToPtr(resolvePtr(resolveRef('tup'))), // follow to location of tuple and treat it like a pointer
      ),
      stack(0),
      context
    )
  ]
});

const mod = makeMultiArgBuiltin('mod', ['a', 'b'], context => { // a % b
  const boolLoc = Symbol(`modCheckLoc`);
  const exit = Symbol(`modExit`);
  const head = Symbol(`modLoopHEad`);
  const a = Symbol(`modMemoryA`);
  const b = Symbol(`modMemoryB`);
  const negB = Symbol(`modMemoryNegB`);
  return [
    ...ops.copy(resolveIntRefVal('a'), ptr(a), context),
    ...ops.copy(resolveIntRefVal('b'), ptr(b), context),
    ...ops.mult(abs(-1), ptr(b), ptr(negB)),

    // main loop. while(b >= a) a -= b
    new HangingLabel(head),
    ...ops.lt(ptr(a), ptr(b), ptr(boolLoc)), // check
    ...ops.jt(abs(0, boolLoc), abs(exit)),  // jump
    ...ops.addTo(ptr(negB), ptr(a)), // subtract
    ...ops.jump(abs(head)), // again

    // allocate variables
    addLabel(0, a),
    addLabel(0, b),
    addLabel(0, negB),

    new HangingLabel(exit),
    ...writeIntToRam(ptr(a), stack(0)),
  ]
});

const div = makeMultiArgBuiltin('div', ['x', 'y'], context => { // x / y
  const boolLoc = Symbol(`divCheckLoc`);
  const exit = Symbol(`divExit`);
  const head = Symbol(`divLoopHEad`);
  const x = Symbol(`divMemoryX`);
  const y = Symbol(`divMemoryY`);
  const acc = Symbol(`divMemoryAcc`);
  const negY = Symbol(`divMemoryNegY`);
  return [
    ...ops.copy(resolveIntRefVal('x'), ptr(x), context),
    ...ops.copy(resolveIntRefVal('y'), ptr(y), context),
    ...ops.copy(abs(0), ptr(acc)),
    ...ops.mult(abs(-1), ptr(y), ptr(negY), context),

    // main loop. while(b >= a) a -= b
    new HangingLabel(head),
    ...ops.lt(ptr(x), ptr(y), ptr(boolLoc)), // check
    ...ops.jt(abs(0, boolLoc), abs(exit)),  // jump
    ...ops.addTo(ptr(negY), ptr(x)), // subtract
    ...ops.addTo(abs(1), ptr(acc)), // inc 
    ...ops.jump(abs(head)), // again

    // allocate variables
    addLabel(0, x),
    addLabel(0, y),
    addLabel(0, acc),
    addLabel(0, negY),

    new HangingLabel(exit),
    ...writeIntToRam(ptr(acc), stack(0)),
  ]
});

export const builtins: BuiltIn[] = [
  none,
  print,
  succ,
  add,
  mult,
  trueFn,
  falseFn,
  doFn,
  eq,
  lt,
  sub,
  getFn,
  mod,
  div,
  input,
];

export type BuiltIn = {
  loc: symbol,
  name: string,
  // this is delayed because some may need to resolve variables
  // from the builtin scope that otherwise may not have been added yet
  // wait
  // thats actually kinda dumb tho cause I can reference builtins by symbol directly lol
  // whatever im not changing it right now
  impl: () => CompileData[],
}

/**
 * stack-3: # of items to allocate
 * stack-2: parent scope
 * stack-1 return address
 */
const allocateScope: CompileData[] = [
  new HangingLabel(locs.allocateScopeSym),
  ...ops.moveStack(3),
  ...ops.copy(ptr(locs.ramPointer), stack(0)),
  ...writeToRam(abs(FintTypes.Scope)),
  ...writeToRam(stack(-2)),
  ...ops.addTo(stack(-3), ptr(locs.ramPointer)),
  ...ops.moveStack(-3),
  ...ops.copy(stack(3), stack(0)),
  ...ops.jump(stack(2)),
]

export const internalBuiltIns: CompileData[] = [
  ...allocateScope,
];
