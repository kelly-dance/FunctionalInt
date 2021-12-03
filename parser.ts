import {
  FintAssignment, FintCall, FintFunct, 
  FintNumberLiteral, FintValue, FintVariableReference, 
  FintWrappedValue, FintTuple,
} from './AST.ts';
import { FintMeta, FintScope, builtinScope, locs } from './typesConstansts.ts';

export const reservedKeys = [
  'where',
  ...'( ) [ ] => = ; ,'.split(' '),
];


export type Token<T extends string = string> = {
  text: T,
  meta: FintMeta,
}

export const tokenizer = (code: string): Token[] => {
  const tokens: Token[] = [];

  const lines = code.split(/\r?\n/g);
  for(let i = 0; i < lines.length; i++){
    let line = lines[i].trimStart();
    const indent = lines[i].length - line.length
    let charIndex = indent;
    let first = true;

    loop: while(line.length){
      charIndex += line.length - line.trimStart().length;
      line = line.trim();
      if(line.startsWith('#')) break;
      for(const key of reservedKeys){
        if(line.startsWith(key)){
          line = line.substring(key.length);
          tokens.push({
            text: key,
            meta: new FintMeta(i + 1, charIndex + 1, indent, first),
          });
          first = false;
          charIndex += key.length;
          continue loop;
        }
      }
      const endOfWord = Math.min(...[' ', ...reservedKeys].map(s => line.indexOf(s)).filter(i => i !== -1));
      if(endOfWord === -Infinity) {
        tokens.push({
          text: line,
          meta: new FintMeta(i + 1, charIndex + 1, indent, first),
        });
        break;
      }else{
        const token = line.substring(0, endOfWord);
        line = line.substring(endOfWord);
        tokens.push({
          text: token,
          meta: new FintMeta(i + 1, charIndex + 1, indent, first),
        });
        first = false;
        charIndex += endOfWord;
      }
    }
  }
  
  return tokens;
}

export type Parser<T> = (tokens: Token[], position: number, scope: FintScope) => ParserResult<T>
export type ParserResult<T> = [success: true, result: T, position: number] | [success: false, result: null, position: number];

export const composeParsers = <T extends any[]>(...parsers: { [K in keyof T]: Parser<T[K]> }): Parser<T> => {
  return (tokens, position, scope) => {
    const vals: any[] = [];
    let pos = position;
    for(const parser of parsers){
      const [success, val, after] = parser(tokens, pos, scope);
      if(!success) return [false, null, position];
      pos = after;
      vals.push(val);
    }
    return [true, vals as T, pos];
  }
}

export const anyParser = <T>(...parsers: Parser<T>[]): Parser<T> => {
  return (tokens, pos, scope) => {
    for(const parser of parsers){
      const result = parser(tokens, pos, scope);
      if(result[0]) return result;
    }
    return [false, null, pos];
  }
}

export const parseToken = <T extends string>(token: T): Parser<Token<T>> => (tokens, pos) => {
  if(pos < tokens.length && tokens[pos].text === token) return [true, tokens[pos] as Token<T>, pos + 1];
  return [false, null, pos];
}

// const parseReservedWord: Parser<FintKeyword> = (tokens, pos) => {
//   if(!keywords.includes(tokens[pos].text)) return [false, null, pos];
//   return [true, new FintKeyword(tokens[pos].meta, tokens[pos].text), pos + 1];
// }

export const parseNumber: Parser<FintNumberLiteral> = (tokens, pos, scope) => {
  if(pos >= tokens.length) return [false, null, pos];
  if(/^-?[0-9]+$/.test(tokens[pos].text)) return [true, new FintNumberLiteral(scope, tokens[pos].meta, BigInt(tokens[pos].text)), pos + 1];
  return [false, null, pos];
}

export const parseRef: Parser<FintVariableReference> = (tokens, pos, scope) => {
  if(pos >= tokens.length) return [false, null, pos];
  const current = tokens[pos];
  if(!reservedKeys.includes(current.text) && /^[_a-zA-Z][_a-zA-Z0-9]*$/.test(current.text)) return [true, new FintVariableReference(scope, current.meta, current.text), pos + 1];
  return [false, null, pos];
}

export const parseTuple: Parser<FintTuple> = (tokens, pos, scope) => {
  const [success, initResults, newPos] = composeParsers(parseToken('['), parseValue)(tokens, pos, scope);
  if(!success) {
    const [emptySuccess, _, newPos] = composeParsers(parseToken('['), parseToken(']'))(tokens, pos, scope);
    if(emptySuccess) return [true, new FintTuple(scope, _![0].meta, []), newPos];
    return [false, null, pos];
  }
  const values = [initResults![1]];
  let curPos = newPos;
  while(true){
    const [success, nextResult, nextPos] = composeParsers(parseToken(','), parseValue)(tokens, curPos, scope);
    if(!success){
      const [close, _, endPos] = parseToken(']')(tokens, curPos, scope);
      if(!close) throw new Error(`Syntax Error in where tuple at ${tokens[curPos].meta.line}:${tokens[curPos].meta.column}`);
      return [true, new FintTuple(scope, initResults![0].meta, values), endPos];
    }
    values.push(nextResult![1]);
    curPos = nextPos;
  }
}

export const parseFnDecl: Parser<FintFunct> = (tokens, pos, scope) => {
  const subScope = new FintScope(scope);
  const [success, results, newPos] = composeParsers(parseRef, parseToken('=>'), parseValue)(tokens, pos, subScope);
  if(!success) return [false, null, pos];
  const [arg, _, body] = results!;
  subScope.add(arg.name);
  return [true, new FintFunct(scope, arg, body), newPos];
}

export const parseParenWrappedVal: Parser<FintWrappedValue> = (tokens, pos, scope) => {
  const [success, results, newPos] = composeParsers(parseToken('('), parseValue, parseToken(')'))(tokens, pos, scope);
  if(!success) return [false, null, pos];
  return [true, new FintWrappedValue(scope, results![1], results![0].meta), newPos];
}

// this is pretty much a way to escape the function call order rearrangement
export const parseDollar: Parser<FintWrappedValue> = (tokens, pos, scope) => {
  const [success, results, newPos] = composeParsers(parseToken('$'), parseValue)(tokens, pos, scope);
  if(!success) return [false, null, pos];
  return [true, new FintWrappedValue(scope, results![1], results![0].meta), newPos];
}

export const parseFnCall: Parser<FintCall> = (tokens, pos, scope) => {
  const [success, results, newPos] = composeParsers(parseCallable, parseValue)(tokens, pos, scope);
  if(!success) return [false, null, pos];
  const [func, arg] = results!;
  
  if(arg.meta.indent < func.meta.indent) return [false, null, pos];
  /*
  I want function calls to look like this:
  add a b
  but the parser without this below logic will read that as
  add (a b)
  this logic forces the paren to move
  (add a) b
  which is correct
  */
  const call = new FintCall(scope, func, arg);
  const rearrange = (c: FintCall) => {
    if(c.arg instanceof FintCall){
      c.fn = new FintCall(scope, c.fn, c.arg.fn);
      rearrange(c.fn as FintCall);
      c.arg = c.arg.arg;
    }
  }
  rearrange(call);
  
  return [true, call, newPos];
}

export const parseValue: Parser<FintValue> = anyParser<FintValue>(parseTuple, parseDollar, parseFnCall, parseFnDecl, parseParenWrappedVal, parseRef, parseNumber);
// note: more than just callables are here because of the way function calls are reordered
export const parseCallable: Parser<FintValue> = anyParser<FintValue>(parseTuple, parseDollar, parseFnDecl, parseParenWrappedVal, parseRef, parseNumber);

export const parseAssignment: Parser<FintAssignment> = (tokens, position, scope) => {
  const subScope = new FintScope(scope, Symbol('assignmentScope'));
  const [success, results, newPos] = composeParsers(parseRef, parseToken('='), parseValue)(tokens, position, subScope);
  if(!success) return [false, null, position];
  const [ref, _, body] = results!;
  let curPos = newPos;
  const [hadSemi] = parseToken(';')(tokens, curPos, subScope);
  if(hadSemi) curPos++;
  if(newPos >= tokens.length || tokens[newPos].text !== 'where') return [true, new FintAssignment(subScope, ref, body, []), curPos];
  const wheres: FintAssignment[] = [];
  curPos++;
  let indent = -1;
  do {
    const [success, assignment, nextPos] = parseAssignment(tokens, curPos, subScope);
    if(!success) throw new Error(`Syntax Error in where caluse at ${tokens[curPos].meta.line}:${tokens[curPos].meta.column}`);
    wheres.push(assignment!);
    subScope.add(assignment!.ref.name);
    curPos = nextPos;
    indent = assignment!.meta.indent;
    if(assignment!.meta.line === ref.meta.line) break;
  } while(curPos < tokens.length && tokens[curPos].meta.indent === indent);
  return [true, new FintAssignment(subScope, ref, body, wheres), curPos];
}

export const parse = (code: string) => {
  const tokens = tokenizer(code);
  const assignments: FintAssignment[] = [];
  const scope = new FintScope(builtinScope, locs.globalScopeSym);
  let pos = 0;
  while(pos < tokens.length){
    const [success, assignment, newPos] = parseAssignment(tokens, pos, scope);
    if(!success) throw new Error(`Failed to parse assignment at ${tokens[pos].meta.line}:${tokens[pos].meta.column}`);
    pos = newPos;
    assignments.push(assignment!);
    scope.add(assignment!.ref.name);
  }
  return assignments;
}
