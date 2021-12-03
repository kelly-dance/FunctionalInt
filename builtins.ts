import { CompileData, FintScope, HangingLabel, locs, CompilationContext, FintMeta, builtinScope, RootLevelCompileData, BreakPoint } from './typesConstansts.ts';
import { ops, ptr, abs, stack, addLabel, resolvePtr, writeToRam, addArgs, absToPtr, resolveRef, stackToPtr, ptrToAbs } from './macros.ts';

// ALL BUILTINS USE SCOPE AT STACK+0
// STACK+1 IS RESERVED
// STACK+2 IS RETURN VALUE

const blankMeta = new FintMeta(-1, -1, -1, true);

const none: BuiltIn = (()=>{
  const loc = Symbol('none');
  return {
    loc,
    name: '_',
    dependsOn: [],
    impl: () => [addLabel(0, loc)],
  }
})();

const makeBuiltin = (
  name: string,
  fac: (context: CompilationContext) => RootLevelCompileData[],
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
        new HangingLabel(loc),
        def,
        locs.builtinScopeSym,
  
        // Function Def
        new HangingLabel(def),
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
  fac: (context: CompilationContext) => RootLevelCompileData[],
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
      ): {impl: RootLevelCompileData[], loc: symbol} => {
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
            new HangingLabel(selfLoc),
      
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
            new HangingLabel(selfLoc),
    
            // note, there is no stack shift here. any calls to resolveRef would fail
            // create inner function instance to return
            ...ops.copy(ptr(locs.ramPointer), stack(2)),
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
        addLabel(loc, instanceLoc),
        locs.builtinScopeSym,
  
        // Function impls
        ...impl,
      ]
    }
  }
}

const print = makeBuiltin('print', context => {
  return [
    ...ops.write(resolveRef('arg', 0), context),
    ...ops.copy(resolveRef('_', 0), stack(0), context),
  ]
}, false, [none]);

const input = makeBuiltin('input', context => {
  const result = Symbol(`addResult`)
  return [
    ...ops.read(ptr(result)),
    ...ops.copy(abs(0, result), stack(0)), // return
  ]
}, false);

const succ = makeBuiltin('succ', context => {
  const result = Symbol('succResult');
  return [
    ...ops.add(resolveRef('arg', 0), abs(1), ptr(result), context), // add 1
    ...ops.copy(abs(0, result), stack(0)), // write to memory and save location
  ]
}, false);

const add = makeMultiArgBuiltin('add', ['a', 'b'], context => {
  const result = Symbol(`addResult`)
  return [
    ...ops.add(
      resolveRef('a', 0),
      resolveRef('b', 0),
      ptr(result),
      context
    ),
    ...ops.copy(abs(0, result), stack(0)), // write and save location
  ]
}, false);

const sub = makeMultiArgBuiltin('sub', ['a', 'b'], context => {
  const result = Symbol(`subResult`)
  return [
    ...ops.mult(resolveRef('b', 0), abs(-1), ptr(result), context), // result = -b
    ...ops.addTo(resolveRef('a', 0), ptr(result), context), // result += a
    ...ops.copy(abs(0, result), stack(0)), // write and save location
  ]
}, false);

const mult = makeMultiArgBuiltin('mult', ['a', 'b'], context => {
  const result = Symbol(`multResult`)
  return [
    ...ops.mult(
      resolveRef('a', 0),
      resolveRef('b', 0),
      ptr(result),
      context
    ),
    ...ops.copy(abs(0, result), stack(0)), // write and save location
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
    ...ops.eq(resolveRef('a', 0), resolveRef('b', 0), ptr(boolLoc), context),
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
    ...ops.eq(resolveRef('a', 0), resolveRef('b', 0), ptr(boolLoc), context),
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
    ...ops.lt(resolveRef('a', 0), resolveRef('b', 0), ptr(boolLoc), context),
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
        addArgs(resolveRef('pos', 0), abs(1)), // skip first location
        absToPtr(resolvePtr(resolveRef('tup', 0))), // follow to location of tuple and treat it like a pointer
      ),
      stack(0),
      context
    )
  ]
}, false);

const list = makeBuiltin('list', context => {
  const loop = Symbol('listCreatorLoop');
  const loopCtr = Symbol('listCreatorLoopControl');
  const loopCond = Symbol('listCreatorLoopCondition');
  return [
    ...ops.copy(ptr(locs.ramPointer), stack(2)), // save tuple location
    ...ops.addTo(addArgs(resolveRef('arg', 0), abs(1)), ptr(locs.ramPointer), context), // allocate space for values
    ...ops.copy(resolveRef('arg', 0), stackToPtr(stack(2)), context), // write length
    ...ops.copy(abs(0), ptr(loopCtr)), // set loopCtr = 0

    new HangingLabel(loop),
    // mem[1+loopCtr] = loopCtr;
    ...ops.copy(
      abs(0, loopCtr),
      addArgs( // (*stack[2]) + 1 + loopCtr 
        addArgs(ptr(loopCtr), abs(1)),
        stackToPtr(stack(2))
      )
    ),
    ...ops.addTo(abs(1), ptr(loopCtr)), // loopCtr++;
    ...ops.eq(resolveRef('arg', 0), ptr(loopCtr), ptr(loopCond), context), // loopCond = arg == loopCtr
    ...ops.jf(abs(0, loopCond), abs(loop)), // if !loopCond goto loop
  ]
}, true);

const map = makeMultiArgBuiltin('map', ['fn', 'ls'], context => {
  const lsLen = Symbol('mapLen');
  const loop = Symbol('mapLoop');
  const loopCtr = Symbol('mapLoopControl');
  const loopCond = Symbol('mapLoopCondition');
  const argLoc = Symbol('mapFnArgLoc');
  const postFn = Symbol('mapAfterCall');
  const scopePtrLoc = Symbol('mapScopePtrLoc');
  return [
    ...ops.copy(ptr(locs.ramPointer), stack(2)), // save tuple location
    ...ops.copy(
      absToPtr(resolvePtr(resolveRef('ls', 0))), // resolve length of ls
      ptr(lsLen),
      context
    ),
    ...ops.addTo( // allocate space for values
      addArgs(
        abs(0, lsLen), // get length of ls
        abs(1)
      ),
      ptr(locs.ramPointer),
      context
    ),
    
    ...ops.copy( // write length
      ptr(lsLen), // get length of ls
      stackToPtr(stack(2)),
      context
    ),

    // build scope for fn calls
    ...ops.moveStack(3), // moving to avoid stuff for internal call
    ...ops.copy(ptr(locs.ramPointer), ptr(scopePtrLoc)), // save scope location
    ...writeToRam(addArgs(resolveRef('fn', -3), ptr(1)), context), // set parent scope
    ...ops.copy(ptr(locs.ramPointer), ptr(argLoc)), // write location for the arg to argLoc
    ...ops.copy(abs(postFn), stack(1)), // save return location

    ...ops.copy(abs(0), ptr(loopCtr)), // set loopCtr = 0

    new HangingLabel(loop),
    ...ops.copy(abs(0, scopePtrLoc), stack(0)), // save scope location
    ...ops.copy( // copy val from original list to arg of scope
      addArgs(
        addArgs(ptr(loopCtr), abs(1)),
        absToPtr(resolvePtr(resolveRef('ls', -3))), // follow to location of tuple and treat it like a pointer
      ),
      ptr(0, argLoc),
      context,
    ),

    // make the call
    ...ops.jump(resolvePtr(absToPtr(resolvePtr(resolveRef('fn', -3)))), context),

    new HangingLabel(postFn),
    // mem[1+loopCtr] = return val;
    ...ops.copy(
      stack(0),
      addArgs( // (*stack[2]) + 1 + loopCtr 
        addArgs(abs(0, loopCtr), abs(1)),
        stackToPtr(stack(-1))
      )
    ),
    ...ops.addTo(abs(1), ptr(loopCtr)), // loopCtr++;
    ...ops.eq(ptr(lsLen), ptr(loopCtr), ptr(loopCond)), // loopCond = lsLen == loopCtr
    ...ops.jf(abs(0, loopCond), abs(loop)), // if !loopCond goto loop

    // after loop
    ...ops.moveStack(-3), // restore stack
  ]
}, true);

const foreach = makeMultiArgBuiltin('foreach', ['fn', 'ls'], context => {
  const lsLen = Symbol('mapLen');
  const loop = Symbol('mapLoop');
  const loopCtr = Symbol('mapLoopControl');
  const loopCond = Symbol('mapLoopCondition');
  const argLoc = Symbol('mapFnArgLoc');
  const postFn = Symbol('mapAfterCall');
  const scopePtrLoc = Symbol('mapScopePtrLoc');
  return [
    ...ops.copy(
      absToPtr(resolvePtr(resolveRef('ls', 0))), // resolve length of ls
      ptr(lsLen),
      context
    ),

    // build scope for fn calls
    ...ops.moveStack(3), // moving to avoid stuff for internal call
    ...ops.copy(ptr(locs.ramPointer), ptr(scopePtrLoc)), // save scope location
    ...writeToRam(addArgs(resolveRef('fn', -3), ptr(1)), context), // set parent scope
    ...ops.copy(ptr(locs.ramPointer), ptr(argLoc)), // write location for the arg to argLoc
    ...ops.copy(abs(postFn), stack(1)), // save return location

    ...ops.copy(abs(0), ptr(loopCtr)), // set loopCtr = 0

    new HangingLabel(loop),
    ...ops.copy(abs(0, scopePtrLoc), stack(0)), // save scope location
    ...ops.copy( // copy val from original list to arg of scope
      addArgs(
        addArgs(ptr(loopCtr), abs(1)),
        absToPtr(resolvePtr(resolveRef('ls', -3))), // follow to location of tuple and treat it like a pointer
      ),
      ptr(0, argLoc),
      context,
    ),

    // make the call
    ...ops.jump(resolvePtr(absToPtr(resolvePtr(resolveRef('fn', -3)))), context),

    new HangingLabel(postFn),
    ...ops.addTo(abs(1), ptr(loopCtr)), // loopCtr++;
    ...ops.eq(abs(0, lsLen), abs(0, loopCtr), ptr(loopCond)), // loopCond = lsLen == loopCtr
    ...ops.jf(abs(0, loopCond), abs(loop)), // if !loopCond goto loop

    // after loop
    ...ops.moveStack(-3), // restore stack
  ]
}, true);

const reduce = makeMultiArgBuiltin('reduce', ['fn', 'acc', 'ls'], context => {
  const lsLen = Symbol('reduceLen');
  const loop = Symbol('reduceLoop');
  const afterLoop = Symbol('reduceAfterLoop');
  const loopCtr = Symbol('reduceLoopControl');
  const loopCond = Symbol('reduceLoopCondition');
  const argLoc = Symbol('reduceFnArgLoc');
  const accWriteLoc = Symbol('reduceFnAccWriteLoc');
  const accLoc = Symbol('reduceFnAccLoc');
  const postOuterFn = Symbol('reduceAfterOuterCall');
  const postInnerFn = Symbol('reduceAfterInnerCall');
  const outerScopePtrLoc = Symbol('reduceOuterScopePtrLoc');
  const innerScopePtrLoc = Symbol('reduceInnerScopePtrLoc');
  return [
    ...ops.copy(ptr(locs.ramPointer), stack(2)), // save tuple location
    ...ops.copy(
      absToPtr(resolvePtr(resolveRef('ls', 0))), // resolve length of ls
      ptr(lsLen),
      context
    ),

    ...ops.moveStack(3), // moving to avoid stuff for internal call

    // build scope for outer fn calls
    ...ops.copy(ptr(locs.ramPointer), ptr(outerScopePtrLoc)), // save scope location
    ...writeToRam(addArgs(resolveRef('fn', -3), ptr(1)), context), // set parent scope
    ...ops.copy(ptr(locs.ramPointer), ptr(argLoc)), // write location for the arg to argLoc

    // build scope for inner fn calls
    ...ops.copy(ptr(locs.ramPointer), ptr(innerScopePtrLoc)), // save scope location
    ...writeToRam(addArgs(ptr(outerScopePtrLoc), ptr(1))), // set parent scope to outer scope ***
    ...ops.copy(ptr(locs.ramPointer), ptr(accLoc)), // write location for the arg to accLoc

    ...ops.copy(resolveRef('acc', -3), ptr(accWriteLoc), context), // initialize acc value
    ...ops.copy(ptr(accWriteLoc), stack(0)), // needed if the list is empty
    ...ops.copy(abs(0), ptr(loopCtr)), // set loopCtr = 0

    new HangingLabel(loop),
    new BreakPoint('enter loop'),
    ...ops.eq(abs(0, lsLen), abs(0, loopCtr), ptr(loopCond)), // loopCond = lsLen == loopCtr
    ...ops.jt(abs(0, loopCond), abs(afterLoop)), // if !loopCond goto loop

    ...ops.copy(abs(0, outerScopePtrLoc), stack(0)), // save scope location
    ...ops.copy( // copy val from original list to arg of scope
      addArgs(
        addArgs(ptr(loopCtr), abs(1)),
        absToPtr(resolvePtr(resolveRef('ls', -3))), // follow to location of tuple and treat it like a pointer
      ),
      ptr(0, argLoc),
      context,
    ),

    ...ops.copy(abs(postOuterFn), stack(1)), // save return location

    // make the call
    ...ops.jump(resolvePtr(absToPtr(resolvePtr(resolveRef('fn', -3)))), context),

    new HangingLabel(postOuterFn),

    ...ops.copy(stack(0), stack(2)), // move return value out of way
    ...ops.copy(abs(0, innerScopePtrLoc), stack(0)), // save scope location
    ...ops.copy( // copy val from original list to arg of scope
      abs(0, accWriteLoc),
      ptr(0, accLoc),
      context,
    ),

    ...ops.copy(abs(postInnerFn), stack(1)), // save return location

    // make the call
    ...ops.jump(resolvePtr(stackToPtr(stack(2)))), /// jump to first value of function instance? idk error around here

    new HangingLabel(postInnerFn),

    // acc = return val;
    ...ops.copy(
      stack(0),
      ptr(accWriteLoc)
    ),
    ...ops.addTo(abs(1), ptr(loopCtr)), // loopCtr++;
    ...ops.jump(abs(loop)),

    new HangingLabel(afterLoop),
    ...ops.moveStack(-3), // restore stack
    ...ops.copy(stack(3), stack(0)), // copy last return value as final return
  ]
}, false);

const len = makeBuiltin('len', context => {
  return [
    ...ops.copy(
      absToPtr(resolvePtr(resolveRef('arg', 0))), // follow to location of tuple and treat it like a pointer
      stack(0),
      context
    )
  ]
}, false);

const fst = makeBuiltin('fst', context => {
  return [
    ...ops.copy(
      addArgs(
        abs(1), // add one to get the second value
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
        abs(2), // add two to get the second value
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
    ...ops.copy(resolveRef('a', 0), ptr(a), context), // save a
    ...ops.copy(resolveRef('b', 0), ptr(b), context), // save b
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
    ...ops.copy(ptr(a), stack(0)),
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
    ...ops.copy(resolveRef('a', 0), ptr(a), context), // save a
    ...ops.copy(resolveRef('b', 0), ptr(b), context), // save b
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
    ...ops.copy(ptr(acc), stack(0)),
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
  list,
  map,
  foreach,
  reduce,
  len,
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
  impl: () => RootLevelCompileData[],
  dependsOn: BuiltIn[],
}

/**
 * stack-3: # of items to allocate
 * stack-2: parent scope
 * stack-1 return address
 */
const allocateScope: RootLevelCompileData[] = [
  new HangingLabel(locs.allocateScopeSym),
  ...ops.copy(ptr(locs.ramPointer), stack(3)),
  ...writeToRam(stack(1)),
  ...ops.addTo(stack(0), ptr(locs.ramPointer)),
  ...ops.copy(stack(3), stack(0)),
  ...ops.jump(stack(2)),
]

export const internalBuiltIns: RootLevelCompileData[] = [
  ...allocateScope,
];
