import { CompileData, FintScope, FintTypes, HangingLabel, locs, CompilationContext, FintMeta, builtinScope } from './typesConstansts.ts';
import { ops, ptr, abs, stack, addLabel, resolvePtr, writeToRam, addArgs, absToPtr, resolveRef, resolveIntRefVal, writeIntToRam } from './macros.ts';

// ALL BUIlTINS USE SCOPE AT STACK+0
// STACK+1 IS RESERVED
// STACK+2 IS RETURN VALUE

const blankMeta = new FintMeta(-1, -1, -1, true);

const none: BuiltIn = (()=>{
  const loc = Symbol('none');
  return {
    loc,
    name: '_',
    dependsOn: [],
    impl: () => [addLabel(FintTypes.None, loc)],
  }
})();

const makeBuiltin = (
  name: string,
  fac: (context: CompilationContext) => CompileData[],
  copyReturn: boolean = true,
  deps: BuiltIn[] = [],
): BuiltIn => {
  const loc = Symbol(name);
  
  return {
    loc,
    name,
    dependsOn: deps,
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
        ...fac(context),

        // copy the return value (if needed)
        ...(copyReturn ? ops.copy(stack(2), stack(0)) : []), 
        ...ops.jump(stack(1)),
      ]
    }
  }
}

const makeMultiArgBuiltin = (
  name: string,
  args: string[],
  fac: (context: CompilationContext) => CompileData[],
  copyReturn: boolean = true,
  deps: BuiltIn[] = [],
): BuiltIn => {

  const instanceLoc = Symbol(`${name}-inst`);

  return {
    name,
    loc: instanceLoc,
    dependsOn: deps,
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
      
            // body
            ...fac(context),
      
            // end of function
            // copy the return value (if needed)
            ...(copyReturn ? ops.copy(stack(2), stack(0)) : []), 
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
    
            // note, there is no stack shift here. any calls to resolveRef would fail
            // create inner function instance to return
            ...ops.copy(ptr(locs.ramPointer), stack(2)),
            ...writeToRam(abs(FintTypes.FunctionInstance)), // data type
            ...writeToRam(abs(loc)), // inner function def address
            ...writeToRam(stack(0)), // scope
    
            // end of function
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
    ...ops.write(resolveIntRefVal('arg', 0), context),
    ...ops.copy(resolveRef('_', 0), stack(0), context),
  ]
}, false, [none]);

const input = makeBuiltin('input', context => {
  const result = Symbol(`addResult`)
  return [
    ...ops.read(ptr(result)),
    ...writeIntToRam(abs(0, result), stack(0)), // write and save location
  ]
}, false);

const succ = makeBuiltin('succ', context => {
  const result = Symbol('succResult');
  return [
    ...ops.add(resolveIntRefVal('arg', 0), abs(1), ptr(result), context), // add 1
    ...writeIntToRam(abs(0, result), stack(0)), // write to memory and save location
  ]
}, false);

const add = makeMultiArgBuiltin('add', ['a', 'b'], context => {
  const result = Symbol(`addResult`)
  return [
    ...ops.add(
      resolveIntRefVal('a', 0),
      resolveIntRefVal('b', 0),
      ptr(result),
      context
    ),
    ...writeIntToRam(abs(0, result), stack(0)), // write and save location
  ]
}, false);

const sub = makeMultiArgBuiltin('sub', ['a', 'b'], context => {
  const result = Symbol(`subResult`)
  return [
    ...ops.mult(resolveIntRefVal('b', 0), abs(-1), ptr(result), context), // result = -b
    ...ops.addTo(resolveIntRefVal('a', 0), ptr(result), context), // result += a
    ...writeIntToRam(abs(0, result), stack(0)), // write and save location
  ]
}, false);

const mult = makeMultiArgBuiltin('mult', ['a', 'b'], context => {
  const result = Symbol(`multResult`)
  return [
    ...ops.mult(
      resolveIntRefVal('a', 0),
      resolveIntRefVal('b', 0),
      ptr(result),
      context
    ),
    ...writeIntToRam(abs(0, result), stack(0)), // write and save location
  ]
}, false);

const trueFn = makeMultiArgBuiltin('true', ['first', 'second'], context => {
  return ops.copy(resolveRef('first', 0), stack(0), context);
}, false);

const falseFn = makeMultiArgBuiltin('false', ['first', 'second'], context => {
  return ops.copy(resolveRef('second', 0), stack(0), context);
}, false);

const doFn = makeBuiltin('do', context => {
  return ops.copy(resolveRef('do', 0), stack(0), context);
}, false);

const eq = makeMultiArgBuiltin('eq', ['a', 'b'], context => {
  const boolLoc = Symbol(`eqCheckLoc`);
  const trueLoc = Symbol(`eqTrueBranch`);
  const endLoc = Symbol(`eqEnd`);
  return [
    ...ops.eq(resolveIntRefVal('a', 0), resolveIntRefVal('b', 0), ptr(boolLoc), context),
    ...ops.jt(abs(0, boolLoc), abs(trueLoc)),
    
    // false branch (not equal)
    ...ops.copy(resolveRef('false', 0), stack(0), context),
    ...ops.jump(abs(endLoc)),

    // true branch (equal)
    new HangingLabel(trueLoc),
    ...ops.copy(resolveRef('true', 0), stack(0), context),

    new HangingLabel(endLoc),
  ];
}, false, [trueFn, falseFn]);

const neq = makeMultiArgBuiltin('neq', ['a', 'b'], context => {
  const boolLoc = Symbol(`eqCheckLoc`);
  const trueLoc = Symbol(`eqTrueBranch`);
  const endLoc = Symbol(`eqEnd`);
  return [
    ...ops.eq(resolveIntRefVal('a', 0), resolveIntRefVal('b', 0), ptr(boolLoc), context),
    ...ops.jf(abs(0, boolLoc), abs(trueLoc)),
    
    // false branch (equal)
    ...ops.copy(resolveRef('false', 0), stack(0), context),
    ...ops.jump(abs(endLoc)),

    // true branch (not equal)
    new HangingLabel(trueLoc),
    ...ops.copy(resolveRef('true', 0), stack(0), context),

    new HangingLabel(endLoc),
  ];
}, false, [trueFn, falseFn]);

const lt = makeMultiArgBuiltin('lt', ['a', 'b'], context => {
  const boolLoc = Symbol(`eqCheckLoc`);
  const trueLoc = Symbol(`eqTrueBranch`);
  const endLoc = Symbol(`eqEnd`);
  return [
    ...ops.lt(resolveIntRefVal('a', 0), resolveIntRefVal('b', 0), ptr(boolLoc), context),
    ...ops.jt(abs(0, boolLoc), abs(trueLoc)),
    
    // false branch
    ...ops.copy(resolveRef('false', 0), stack(0), context),
    ...ops.jump(abs(endLoc)),

    // true branch
    new HangingLabel(trueLoc),
    ...ops.copy(resolveRef('true', 0), stack(0), context),

    new HangingLabel(endLoc),
  ];
}, false, [trueFn, falseFn]);

const getFn = makeMultiArgBuiltin('get', ['pos', 'tup'], context => {
  return [
    ...ops.copy(
      addArgs(
        addArgs(resolveIntRefVal('pos', 0), abs(1)), // skip the data type tag
        absToPtr(resolvePtr(resolveRef('tup', 0))), // follow to location of tuple and treat it like a pointer
      ),
      stack(0),
      context
    )
  ]
}, false);

const fst = makeBuiltin('fst', context => {
  return [
    ...ops.copy(
      addArgs(
        abs(1), // skip the data type tag 
        absToPtr(resolvePtr(resolveRef('arg', 0))), // follow to location of tuple and treat it like a pointer
      ),
      stack(0),
      context
    )
  ]
}, false);

const snd = makeBuiltin('snd', context => {
  return [
    ...ops.copy(
      addArgs(
        abs(1 + 1), // skip the data type tag and get second value
        absToPtr(resolvePtr(resolveRef('arg', 0))), // follow to location of tuple and treat it like a pointer
      ),
      stack(0),
      context
    )
  ]
}, false);

/*
ok ok ok so my old definition of subtraction was purely repeated subtraction of the divisor
so the new definition can be thought of at the high level in terms of the old one
newMod = n => base => n < base*base ? mod n base : mod (newMod n base*base) b
*/
const mod = makeMultiArgBuiltin('mod', ['b', 'a'], context => { // a % b
  const boolLoc = Symbol(`modCheckLoc`);
  const boolLocSquare = Symbol(`modCheckLocSqaure`);
  const boolLocExit = Symbol(`modCheckExit`);
  const boolLocExitInner = Symbol(`modCheckInner`);
  const exit = Symbol(`modExit`);
  const innerExit = Symbol(`modInnerExit`);
  const maybeExit = Symbol(`modMaybeExit`);
  const head = Symbol(`modLoopHEad`);
  const a = Symbol(`modMemoryA`);
  const b = Symbol(`modMemoryB`);
  return [
    ...ops.copy(resolveIntRefVal('a', 0), ptr(a), context), // save a
    ...ops.copy(resolveIntRefVal('b', 0), ptr(b), context), // save b
    ...ops.moveStack(2),
    ...ops.copy(ptr(b), stack(0)), // push b (BASE)
    ...ops.mult(ptr(b), abs(-1), stack(1)), // push -b (-BASE)

    new HangingLabel(head),
    // if a < BASE jump to maybeExit
    ...ops.lt(ptr(a), stack(0), ptr(boolLoc)),
    ...ops.jt(abs(0, boolLoc), abs(maybeExit)),
    
    // check if recursion needed
    ...ops.moveStack(2), 
    // push BASE*b and negative to stack
    // ...ops.mult(ptr(b), stack(-1), stack(1)), 
    ...ops.mult(abs(16), stack(-1), stack(1)), 
    // ...ops.mult(ptr(b), stack(-2), stack(0)),
    ...ops.mult(abs(16), stack(-2), stack(0)),
    // if BASE*b < a recurse by jumping to head
    ...ops.lt(stack(0), ptr(a), ptr(boolLocSquare)),
    ...ops.jt(abs(0, boolLocSquare), abs(head)),
    ...ops.moveStack(-2), // else move stack back

    // while(a >= BASE) a -= BASE
    new HangingLabel(innerExit),
    ...ops.add(ptr(a), stack(1), ptr(a)),
    ...ops.lt(ptr(a), stack(0), ptr(boolLocExitInner)),
    ...ops.jf(abs(0, boolLocExitInner), abs(innerExit)),

    // jump back to head
    ...ops.jump(abs(head)),

    // allocate variables
    addLabel(0, a),
    addLabel(0, b),

    //exit decider
    new HangingLabel(maybeExit),
    ...ops.eq(stack(0), ptr(b), ptr(boolLocExit)),
    ...ops.moveStack(-2),
    ...ops.jt(abs(0, boolLocExit), abs(exit)),
    ...ops.jump(abs(head)),

    new HangingLabel(exit),
    ...writeIntToRam(ptr(a), stack(0)),
  ]
}, false);

const div = makeMultiArgBuiltin('div', ['b', 'a'], context => { // a % b
  const boolLoc = Symbol(`divCheckLoc`);
  const boolLocSquare = Symbol(`divCheckLocSqaure`);
  const boolLocExit = Symbol(`divCheckExit`);
  const boolLocExitInner = Symbol(`divCheckInner`);
  const exit = Symbol(`divExit`);
  const innerExit = Symbol(`divInnerExit`);
  const maybeExit = Symbol(`divMaybeExit`);
  const head = Symbol(`divLoopHEad`);
  const a = Symbol(`divMemoryA`);
  const b = Symbol(`divMemoryB`);
  const acc = Symbol(`divMemoryAcc`);
  return [
    ...ops.copy(resolveIntRefVal('a', 0), ptr(a), context), // save a
    ...ops.copy(resolveIntRefVal('b', 0), ptr(b), context), // save b
    ...ops.copy(abs(0), ptr(acc)),
    ...ops.moveStack(3),
    ...ops.copy(ptr(b), stack(0)), // push b (BASE)
    ...ops.mult(ptr(b), abs(-1), stack(1)), // push -b (-BASE)
    ...ops.copy(abs(1), stack(2)), // push 1

    new HangingLabel(head),
    // if a < BASE jump to maybeExit
    ...ops.lt(ptr(a), stack(0), ptr(boolLoc)),
    ...ops.jt(abs(0, boolLoc), abs(maybeExit)),
    
    // check if recursion needed
    ...ops.moveStack(3), 
    // push BASE*b and negative to stack
    // ...ops.mult(ptr(b), stack(-3), stack(0)),
    ...ops.mult(abs(16), stack(-3), stack(0)),
    // ...ops.mult(ptr(b), stack(-2), stack(1)), 
    ...ops.mult(abs(16), stack(-2), stack(1)), 
    ...ops.mult(abs(16), stack(-1), stack(2)),
    // if BASE*b < a recurse by jumping to head
    ...ops.lt(stack(0), ptr(a), ptr(boolLocSquare)),
    ...ops.jt(abs(0, boolLocSquare), abs(head)),
    ...ops.moveStack(-3), // else move stack back

    // while(a >= BASE) a -= BASE
    new HangingLabel(innerExit),
    ...ops.add(ptr(a), stack(1), ptr(a)),
    ...ops.add(ptr(acc), stack(2), ptr(acc)),
    ...ops.lt(ptr(a), stack(0), ptr(boolLocExitInner)),
    ...ops.jf(abs(0, boolLocExitInner), abs(innerExit)),

    // jump back to head
    ...ops.jump(abs(head)),

    // allocate variables
    addLabel(0, a),
    addLabel(0, b),
    addLabel(0, acc),

    //exit decider
    new HangingLabel(maybeExit),
    ...ops.eq(stack(0), ptr(b), ptr(boolLocExit)),
    ...ops.moveStack(-3),
    ...ops.jt(abs(0, boolLocExit), abs(exit)),
    ...ops.jump(abs(head)),

    new HangingLabel(exit),
    ...writeIntToRam(ptr(acc), stack(0)),
  ]
}, false);

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
  neq,
  lt,
  sub,
  getFn,
  fst,
  snd,
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
  dependsOn: BuiltIn[],
}

/**
 * stack-3: # of items to allocate
 * stack-2: parent scope
 * stack-1 return address
 */
const allocateScope: CompileData[] = [
  new HangingLabel(locs.allocateScopeSym),
  ...ops.copy(ptr(locs.ramPointer), stack(3)),
  ...writeToRam(abs(FintTypes.Scope)),
  ...writeToRam(stack(1)),
  ...ops.addTo(stack(0), ptr(locs.ramPointer)),
  ...ops.copy(stack(3), stack(0)),
  ...ops.jump(stack(2)),
]

export const internalBuiltIns: CompileData[] = [
  ...allocateScope,
];
