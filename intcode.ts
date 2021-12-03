// this is just taken from my advent of code 2019 solutions. havent added anything to it during this project

import { DefaultMap, digitsOfBigInt, range } from './tools.ts';

export class MachineMemory extends DefaultMap<bigint, bigint>{
  constructor(){
    super(() => 0n);
  }

  get(key: bigint){
    if(key < 0n) throw new Error(`Accessed negative address ${key}`);
    return super.get(key);
  }
}

export type MachineState = {
  running: boolean,
  complete: boolean,
  pointer: bigint,
  relBase: bigint,
  memory: MachineMemory,
}

export type MachineInterface = {
  write(data: bigint): [halt: boolean, callback?: () => any],
  read(): [result: bigint, halt: boolean, callback?: () => any],
}

type ArgInterface = {
  location: bigint,
  mode: bigint,
  readRaw(): bigint,
  read(): bigint,
  write(value: bigint): void,
}

export const terminal: MachineInterface = {
  read: () => {
    const inp = prompt('>');
    if(inp === null) throw new Error('No input!');
    return [BigInt(parseInt(inp)), false];
  },
  write: data => {
    console.log(data.toString())
    return [false];
  }
}

export const voidInterface: MachineInterface = {
  read: () => [0n, false],
  write: () => [false],
}

export type Operator = (state: MachineState, args: ArgInterface[], mInterface: MachineInterface) => void

export const operators: Map<bigint, Operator> = new Map();

// add
operators.set(1n, (state, accessor) => {
  accessor[2].write(accessor[0].read() + accessor[1].read())
  state.pointer += 4n
})

// multiply
operators.set(2n, (state, accessor) => {
  accessor[2].write(accessor[0].read() * accessor[1].read())
  state.pointer += 4n
})

// read
operators.set(3n, (state, accessor, mInterface) => {
  const [data, halt, callback] = mInterface.read();
  accessor[0].write(data);
  state.pointer += 2n
  if(halt) {
    state.running = false;
    if(callback) callback();
  }
})

// write
operators.set(4n, (state, accessor, mInterface) => {
  const data = accessor[0].read();
  const [halt, callback] = mInterface.write(data);
  state.pointer += 2n
  if(halt) {
    state.running = false;
    if(callback) callback();
  }
})

// jump if true
operators.set(5n, (state, accessor) => {
  if(accessor[0].read() !== 0n) state.pointer = accessor[1].read()
  else state.pointer += 3n
})

// jump if false
operators.set(6n, (state, accessor) => {
  if(accessor[0].read() === 0n) state.pointer = accessor[1].read()
  else state.pointer += 3n
})

// less than
operators.set(7n, (state, accessor) => {
  accessor[2].write(accessor[0].read() < accessor[1].read() ? 1n : 0n)
  state.pointer += 4n
})

// equals
operators.set(8n, (state, accessor) => {
  accessor[2].write(accessor[0].read() === accessor[1].read() ? 1n : 0n)
  state.pointer += 4n
})

// set rel base
operators.set(9n, (state, accessor) => {
  state.relBase += accessor[0].read()
  state.pointer += 2n
})

// end
operators.set(99n, (state, accessor) => {
  state.running = false;
  state.complete = true;
})

export const prepareState = (program: (bigint | number)[], breakpoints?: Map<number, string>): MachineState => {
  const memory = new MachineMemory();
  for(let i = 0; i < program.length; i++){
    memory.set(BigInt(i), BigInt(program[i]));
  }
  return {
    memory,
    pointer: 0n,
    relBase: 0n,
    running: false,
    complete: false,
  }
}

// debug stuffs
const opNameMap = new Map<bigint, string>();
opNameMap.set(1n, 'ADD');
opNameMap.set(2n, 'MULT');
opNameMap.set(3n, 'READ');
opNameMap.set(4n, 'WRITE');
opNameMap.set(5n, 'JTRUE');
opNameMap.set(6n, 'JFALSE');
opNameMap.set(7n, 'LT');
opNameMap.set(8n, 'EQ');
opNameMap.set(9n, 'REBASE');
opNameMap.set(99n, 'EXIT');
const opModeMap = new Map<bigint, string>();
opModeMap.set(0n, 'PTR');
opModeMap.set(1n, 'ABS');
opModeMap.set(2n, 'SP');
const opArgMap = new Map<bigint, number>();
opArgMap.set(1n, 3);
opArgMap.set(2n, 3);
opArgMap.set(3n, 1);
opArgMap.set(4n, 1);
opArgMap.set(5n, 2);
opArgMap.set(6n, 2);
opArgMap.set(7n, 3);
opArgMap.set(8n, 3);
opArgMap.set(9n, 1);
opArgMap.set(99n,0);

export const run = (state: MachineState, mInterface: MachineInterface) => {
  if(state.complete) throw new Error('Trying to boot a machine that is already complete?');
  if(state.running) throw new Error('Trying to boot a machine that is already running?');
  state.running = true;
  while(state.running){
    const opinfo = state.memory.get(state.pointer);
    const digits = digitsOfBigInt(opinfo, 5);

    const opcode = opinfo % 100n;
    if(!operators.has(opcode)) throw new Error(`Invalid op code! ${opcode}, position: ${state.pointer}`);

    const modes = digits.slice(2);
    const argAccesssors: ArgInterface[] = modes.map((mode, i) => {
      const location = state.pointer + BigInt(i + 1);
      const accessor: ArgInterface = {
        mode,
        location,
        readRaw: () => state.memory.get(location),
        read: () => {
          if(mode === 0n) return state.memory.get(accessor.readRaw());
          if(mode === 1n) return accessor.readRaw();
          if(mode === 2n) return state.memory.get(state.relBase + accessor.readRaw());
          throw new Error('Unsupported parameter mode')
        },
        write: value => {
          if(mode === 0n) state.memory.set(accessor.readRaw(), value);
          else if(mode === 1n) throw new Error('Cannot write in immediate mode');
          else if(mode === 2n) state.memory.set(state.relBase + accessor.readRaw(), value);
          else throw new Error('Unsupported parameter mode')
        }
      }
      return accessor;
    })
    operators.get(opcode)!(state, argAccesssors, mInterface);
  }
  return state;
}

type DebugSettings = {
  breakpoints: Map<bigint, string>,
  labels: Map<bigint, string[]>,
  dumpMemFilename: string,
  logMemInteraction: boolean,
  logEachOp: boolean,
}
const defaultDebugSettings: DebugSettings = {
  breakpoints: new Map(),
  labels: new Map(),
  dumpMemFilename: 'memdump.txt',
  logMemInteraction: false,
  logEachOp: false,
}
export const debugRun = (state: MachineState, mInterface: MachineInterface, settings: Partial<DebugSettings> = defaultDebugSettings) => {
  if(state.complete) throw new Error('Trying to boot a machine that is already complete?');
  if(state.running) throw new Error('Trying to boot a machine that is already running?');
  const fullSettings: DebugSettings = { ...defaultDebugSettings, ...settings };
  state.running = true;
  let stepping = false;
  let lastPause = 0;
  const handlePause = (): void => {
    const input = prompt('Command: ("info" for more info)')
    if(!input) return;
    switch(input){
      case 's':
      case 'step': {
        stepping = true;
        return;
      }
      case 'f':
      case 'forward': {
        return;
      }
      case 'm':
      case 'memory': {
        fullSettings.logMemInteraction = !fullSettings.logMemInteraction;
        return handlePause();
      }
      case 'o':
      case 'ops': {
        fullSettings.logEachOp = !fullSettings.logEachOp;
        return handlePause();
      }
      case 'd':
      case 'dump': {
        const mem = [...state.memory.entries()].sort(([a],[b]) => Number(a - b));
        const dump = mem.map(([a, v]) => `${a}: ${v} ${fullSettings.labels.get(a)?.join(' ')}`).join('\n');
        Deno.writeTextFileSync(fullSettings.dumpMemFilename, dump);
        return handlePause();
      }
      case 'i':
      case 'info': {
        console.log([
          `Available Commands:`,
          `(s)tep: steps forward single instruction and logs all activity`,
          `(f)orward: runs to next breakpoint`,
          `(m)emory: toggles logging memory interactions`,
          `(o)ps: toggles logging each op`,
          `(d)ump: dumps memory to file specificied in debugger settings (default: memdump.txt)`,
          `(i)nfo: this`,
        ].join('\n'))
        return handlePause();
      }
      default: {
        console.log("Unrecognized command. Use 'info' to see available commands!")
        return handlePause();
      }
    }
  }

  while(state.running){

    if(stepping || fullSettings.breakpoints.has(state.pointer)){
      stepping = false;
      if(lastPause > 1) console.log(`${lastPause} instructions ran`)
      if(fullSettings.breakpoints.has(state.pointer))
        console.log(`=== DEBUGGER HIT BREAKPOINT: ${fullSettings.breakpoints.get(state.pointer)} ===`)
      console.log(`Loc: ${state.pointer}, Base: ${state.relBase} `)
      lastPause = 0;
      handlePause();
    }

    const opinfo = state.memory.get(state.pointer);
    const digits = digitsOfBigInt(opinfo, 5);

    const opcode = opinfo % 100n;
    if(!operators.has(opcode)) throw new Error(`Invalid op code! ${opcode}, position: ${state.pointer}`);

    const modes = digits.slice(2);
    const argAccesssors: ArgInterface[] = modes.map((mode, i) => {
      const location = state.pointer + BigInt(i + 1);
      const accessor: ArgInterface = {
        mode,
        location,
        readRaw: () => state.memory.get(location),
        read: () => {
          if(mode === 0n) return state.memory.get(accessor.readRaw());
          if(mode === 1n) return accessor.readRaw();
          if(mode === 2n) return state.memory.get(state.relBase + accessor.readRaw());
          throw new Error('Unsupported parameter mode')
        },
        write: value => {
          if(mode === 0n) {
            if(fullSettings.logMemInteraction || stepping) console.log(`Writing ${value} to location ${accessor.readRaw()}`)
            state.memory.set(accessor.readRaw(), value);
          }
          else if(mode === 1n) throw new Error('Cannot write in immediate mode');
          else if(mode === 2n) {
            if(fullSettings.logMemInteraction || stepping) console.log(`Writing ${value} to location ${state.relBase + accessor.readRaw()} (rel${accessor.readRaw()})`)
            state.memory.set(state.relBase + accessor.readRaw(), value);
          }
          else throw new Error('Unsupported parameter mode')
        }
      }
      return accessor;
    })
    if(fullSettings.logEachOp || stepping) {
      const labelDesc = range(opArgMap.get(opcode)! + 1)
        .map(o => [o, fullSettings.labels.get(BigInt(o) + state.pointer)] as [number, string[] | undefined])
        .filter(([o, l]) => l && l.length)
        .map(([o, l]) => `${o}: ${l!.join(', ')}`)
        .join(' ');
      const opDesc = `${opNameMap.get(opcode)}(${range(opArgMap.get(opcode)!).map(i => `${opModeMap.get(modes[i])} ${state.memory.get(state.pointer + 1n + BigInt(i))}`).join(', ')})`
      console.log(`Loc: ${state.pointer}, Base: ${state.relBase}, ${labelDesc ? `Labels: ${labelDesc}, ` : ''}Executing: ${opDesc} `)
    }
    operators.get(opcode)!(state, argAccesssors, mInterface);
    lastPause++;
  }
  return state;
}

// everything below this is unused for this project. its just kinda here

type ScriptMessageProvide = {
  mode: 'provide',
  data: bigint,
  target: number,
}
type ScriptMessageReceive = {
  mode: 'receive',
  target: number,
}
type ScriptMessage = ScriptMessageProvide | ScriptMessageReceive
type Script = (provide: (val: bigint) => ScriptMessageProvide, receive: () => ScriptMessageReceive) => Generator<ScriptMessage, void, bigint>

export const scriptManager = (machine: MachineState, script: Script) => {
  const provide = (val: bigint): ScriptMessageProvide => ({ mode: 'provide', data: val, target: 0 })
  const receive = (): ScriptMessageReceive => ({ mode: 'receive', target: 0 })
  const scriptGen = script(provide, receive);
  let lastMsg: IteratorResult<ScriptMessage> = scriptGen.next();
  const mInterface: MachineInterface = {
    read: () => {
      // console.log(`Read`)
      if(lastMsg.done) throw new Error('Reached end of script early');
      if(lastMsg.value.mode !== 'provide') throw new Error('Tried to read a value when script was not providing');
      const response = lastMsg.value.data
      lastMsg = scriptGen.next();
      return [response, false];
    },
    write: data => {
      // console.log(`Write`)
      if(lastMsg.done) throw new Error('Reached end of script early');
      if(lastMsg.value.mode !== 'receive') throw new Error('Tried to read a value when script was not receiving');
      lastMsg = scriptGen.next(data);
      return [false];
    },
  }
  run(machine, mInterface);
}

type MultiScript = (
  computers: {
    machine: MachineState,
    provide: (val: bigint) => ScriptMessageProvide,
    receive: () => ScriptMessageReceive
  }[]
) => Generator<ScriptMessage, void, bigint>

export const multiScriptManager = (machines: MachineState[], script: MultiScript): void => {
  const scriptGen = script(machines.map((machine, i) => {
    return {
      machine,
      receive: () => ({ mode: 'receive', target: i }),
      provide: val => ({ mode: 'provide', target: i, data: val }),
    }
  }));
  let lastMsgs: (IteratorResult<ScriptMessage> | undefined)[] = machines.map(() => undefined);
  const interfaces: MachineInterface[] = machines.map((_, i) => ({
    read: () => {
      // console.log(`Read ${i}`, lastMsgs[i]?.value)
      if(lastMsgs[i]?.done) throw new Error('Reached end of script early');
      if(lastMsgs[i]?.value.mode !== 'provide') throw new Error('Tried to read a value when script was not providing');
      const response = lastMsgs[i]?.value.data
      const next = scriptGen.next();
      if(next.done) return [response, false];
      const nextIndex = next.value.target;
      lastMsgs[nextIndex] = next;
      if(nextIndex === i) return [response, false];
      else{
        return [response, true, () => {
          run(machines[nextIndex], interfaces[nextIndex])
        }];
      }
    },
    write: data => {
      // console.log(`Write ${i}`, lastMsgs[i]?.value)
      if(lastMsgs[i]?.done) throw new Error('Reached end of script early');
      if(lastMsgs[i]?.value.mode !== 'receive') throw new Error('Tried to read a value when script was not receiving');
      const next = scriptGen.next(data);
      if(next.done) return [false];
      const nextIndex = next.value.target;
      lastMsgs[nextIndex] = next;
      if(nextIndex === i) return [false];
      else{
        return [true, () => {
          run(machines[nextIndex], interfaces[nextIndex])
        }];
      }
    },
  }));
  const first = scriptGen.next();
  if(first.done) throw new Error('Empty script?');
  const firstIndex = first.value.target;
  lastMsgs[firstIndex] = first;
  run(machines[firstIndex], interfaces[firstIndex]);
}
