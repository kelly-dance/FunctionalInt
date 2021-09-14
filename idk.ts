import { CompileData, HangingLabel } from './typesConstansts.ts';
import * as int from './intcode.ts';
import { ops, ptr, abs, addLabel, addArgs, absToPtr, finalize, multArgs } from './macros.ts';

const loaderDest = 10000000n;
const loaderLoc = Symbol('loader');
const loaderEnd = Symbol('loaderEnd');
const relocatorLoopControl = Symbol('loopControl');

const loaderShiftedCounter = Symbol('loaderShiftedCounter');
const loaderShiftedLoopHead = Symbol('loaderShiftedLoopHead');
const loaderShiftedLoopControl = Symbol('loaderShiftedLoopControl');
const loaderWriteLocationControl = Symbol('heck');

const counterLoc = absToPtr(addArgs(abs(loaderDest), abs(loaderShiftedCounter)));
const loopHead = addArgs(addArgs(multArgs(abs(-1), abs(loaderLoc)), abs(loaderShiftedLoopHead)), abs(loaderDest));
const loopControl = absToPtr(addArgs(addArgs(multArgs(abs(-1), abs(loaderLoc)), abs(loaderShiftedLoopControl)), abs(loaderDest)));
const writeLoc = absToPtr(addArgs(addArgs(multArgs(abs(-1), abs(loaderLoc)), abs(loaderWriteLocationControl)), abs(loaderDest)));

const prog: CompileData[] = [
  // move below program out where it wont get hit
  ...ops.lt(ptr(loaderEnd), addArgs(multArgs(abs(-1), abs(loaderLoc)), abs(loaderEnd)), ptr(relocatorLoopControl)),
  ...ops.jf(abs(0, relocatorLoopControl), abs(loaderDest)),
  ...ops.copy(addArgs(ptr(loaderEnd), ptr(loaderLoc)), addArgs(ptr(loaderEnd), ptr(loaderDest))),
  ...ops.addTo(abs(1), ptr(loaderEnd)),
  ...ops.jump(abs(0)),

  new HangingLabel(loaderLoc),
  ...ops.read(counterLoc),
  ...ops.addTo(abs(-1), counterLoc),
  new HangingLabel(loaderShiftedLoopHead),
  ...ops.lt(counterLoc, abs(0), loopControl),
  ...ops.jt(abs(0, loaderShiftedLoopControl), abs(0)),
  ...ops.copy(counterLoc, writeLoc),
  ...ops.read(ptr(0, loaderWriteLocationControl)),
  ...ops.addTo(abs(-1), counterLoc),
  ...ops.jump(loopHead),

  addLabel(0, loaderShiftedCounter),
  addLabel(0, loaderEnd),
];

const code = finalize(prog);

const machine = int.prepareState(code);

const testProg: CompileData[] = [
  ...ops.write(abs(999)),
  ...ops.exit(),
]
const compiledTestProg = finalize(testProg);

int.scriptManager(machine, function*(provide, recieve) {
  yield provide(BigInt(compiledTestProg.length));
  for(const val of compiledTestProg.reverse()) {
    yield provide(val);
  }
  const out = yield recieve();
  console.log(out);
});



