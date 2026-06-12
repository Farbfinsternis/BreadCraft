// Token vocabulary for the .crumb lexer — the first real, testable lexical truth
// for BreadCraft. The Monaco Monarch tokenizer (renderer/src/monaco/crumb.ts) is
// a separate, UI-only mechanism for now; later it can be derived from this lexer
// (memory: breadcraft-tokenizer-ssot).
//
// EISEN M2.T1: the lexer no longer decides GRAMMAR CLASS. Every identifier-shaped
// lexeme is emitted as a single `Word`; whether that word is a keyword, command,
// function, or constant is resolved at parse time (the `eff`/classify bridge in
// parser.ts). That removes the "classification on the wrong layer" rot (R3) and
// lets the editor share one lexer with the transpiler. The classified types below
// (Keyword/Command/Function/Constant/Type) therefore no longer appear in the
// lexer's OUTPUT — they are the values `classify(word)` returns to the parser.

export enum TokenType {
  // Trivia / structure
  Comment = 'Comment',
  Newline = 'Newline', // statement separator; significant, so it is a token
  StatementSep = 'StatementSep', // ':' separates multiple statements on one line
  EOF = 'EOF',

  // Literals
  String = 'String',
  NumberDec = 'NumberDec',
  NumberHex = 'NumberHex', // $FF
  NumberBin = 'NumberBin', // %1010

  // Every identifier-shaped lexeme the lexer emits (memory: breadcraft-tokenizer-ssot).
  Word = 'Word',

  // Grammar classes — NOT emitted by the lexer; only returned by classify(word) at
  // parse time to give a Word its role (unknown words classify as Identifier).
  Identifier = 'Identifier',
  Keyword = 'Keyword',
  Command = 'Command',
  Function = 'Function',
  Constant = 'Constant',
  Type = 'Type',

  // Punctuation / operators
  Operator = 'Operator',
  LParen = 'LParen',
  RParen = 'RParen',
  LBracket = 'LBracket',
  RBracket = 'RBracket',
  Comma = 'Comma',
  Backslash = 'Backslash', // record field access: tasche[3]\count (Sprachdef §C)
  TypeSuffix = 'TypeSuffix', // .b / .w / $ / .RecordName attached to a name (memory: breadcraft-functions-vs-statements)

  // Anything the lexer cannot make sense of (e.g. an unterminated string). The
  // lexer never throws — it emits an Error token with a position and continues.
  Error = 'Error'
}

export interface Token {
  type: TokenType
  /** The exact source text of the token (for strings: the inner text, no quotes). */
  value: string
  /** 1-based line number where the token starts. */
  line: number
  /** 1-based column where the token starts. */
  col: number
  /** Length in source characters (so the editor/parser can map back to a range). */
  length: number
  /** Present only on Error tokens: a short, human-readable reason. */
  error?: string
}
