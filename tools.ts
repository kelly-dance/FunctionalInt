// stuff all taken from my advent of code tools file

export const readFile = (path: string) => (new TextDecoder("utf-8")).decode(Deno.readFileSync(path)).replaceAll('\r','');

export class DefaultMap<K, V> extends Map<K, V>{
  derive: (key: K) => V;

  constructor(deriveDefault: (key: K) => V){
    super();
    this.derive = deriveDefault;
  }

  get(key: K): V {
    const stored = super.get(key);
    if(stored === undefined) {
      const computed = this.derive(key);
      this.set(key, computed)
      return computed;
    }
    return stored;
  }

  apply(key: K, fn: (val: V, key: K) => V): this {
    this.set(key, fn(this.get(key), key));
    return this;
  }

  has(key: K){
    return true;
  }
}

/**
 * [start, end)
 * if only 1 param is passed start is 0 and param is end
 * increment defaults to 1
 */
export function range(start: number, end: number, inc?: number): number[];
export function range(end: number): number[];
export function range(start: number, end?: number, inc: number = 1): number[] {
  if(!end){
    end = start;
    start = 0;
  }
  return Array.from(
    { length: Math.ceil((end - start) / inc) },
    (_, i) => i * inc + start
  );
}

export const digitsOfBigInt = (n: bigint, pad: number | null = null) => {
  if(n < 0) throw new Error('Invalid argument, number must be positive');
  const digits: bigint[] = [];
  while(n > 0){
    digits.push(n % 10n);
    n /= 10n;
  }
  if(pad !== null) while(digits.length < pad) digits.push(0n);
  return digits;
}

export const bigIntFromDigits = (digits: bigint[]) => digits.map((n, i) => n * 10n ** BigInt(i)).reduce((a, n) => a + n, 0n);

