/**
 * Uses the TypeScript type checker to describe what every controller handler
 * returns (the resolved type of its Promise), as a JSON-schema-like object.
 *   node scripts/openapi/extract-response-types.js > response-types.json
 */
const path = require('path');
const ts = require('typescript');

const root = path.join(__dirname, '..', '..');
const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
const config = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, root);
const program = ts.createProgram(config.fileNames.filter((f) => !f.endsWith('.spec.ts')), config.options);
const checker = program.getTypeChecker();
const HTTP = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

function schemaOf(type, depth, seen) {
  if (depth > 7) return { type: 'object' };
  const flags = type.flags;
  if (flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown) return {};
  if (flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return { type: 'null' };
  if (flags & ts.TypeFlags.Null) return { type: 'null' };
  if (flags & ts.TypeFlags.StringLiteral) return { type: 'string', enum: [type.value] };
  if (flags & ts.TypeFlags.NumberLiteral) return { type: 'number', enum: [type.value] };
  if (flags & ts.TypeFlags.BooleanLiteral) return { type: 'boolean' };
  if (flags & ts.TypeFlags.String) return { type: 'string' };
  if (flags & ts.TypeFlags.Number) return { type: 'number' };
  if (flags & ts.TypeFlags.Boolean) return { type: 'boolean' };
  if (flags & ts.TypeFlags.BigInt) return { type: 'string' };
  if (type.isUnion()) {
    const parts = type.types;
    const lits = parts.filter((t) => t.flags & ts.TypeFlags.StringLiteral);
    const nullable = parts.some((t) => t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined));
    const rest = parts.filter((t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.StringLiteral | ts.TypeFlags.BooleanLiteral)));
    const bools = parts.some((t) => t.flags & ts.TypeFlags.BooleanLiteral);
    let s;
    if (lits.length && !rest.length) s = { type: 'string', enum: lits.map((t) => t.value) };
    else if (bools && !rest.length && !lits.length) s = { type: 'boolean' };
    else if (rest.length === 1 && !lits.length) s = schemaOf(rest[0], depth, seen);
    else s = { oneOf: [...rest.map((t) => schemaOf(t, depth + 1, seen)), ...(lits.length ? [{ type: 'string', enum: lits.map((t) => t.value) }] : [])] };
    return nullable ? { ...s, nullable: true } : s;
  }
  const sym = type.getSymbol() || type.aliasSymbol;
  const name = sym ? sym.getName() : '';
  if (name === 'Date') return { type: 'string', format: 'date-time' };
  if (name === 'Buffer' || name === 'StreamableFile' || name === 'Readable') return { type: 'string', format: 'binary' };
  if (name === 'Promise') return schemaOf(checker.getTypeArguments(type)[0] || type, depth, seen);
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const args = checker.getTypeArguments(type);
    return { type: 'array', items: args[0] ? schemaOf(args[0], depth + 1, seen) : {} };
  }
  if (flags & ts.TypeFlags.Object) {
    if (seen.has(type)) return { type: 'object' };
    const next = new Set(seen); next.add(type);
    const props = checker.getPropertiesOfType(type);
    const index = checker.getIndexInfosOfType(type);
    if (!props.length && index.length) return { type: 'object', additionalProperties: schemaOf(index[0].type, depth + 1, next) };
    const properties = {};
    const required = [];
    for (const p of props) {
      const decl = p.valueDeclaration || (p.declarations && p.declarations[0]);
      if (decl && (ts.isMethodDeclaration(decl) || ts.isMethodSignature(decl))) continue;
      const pt = checker.getTypeOfSymbolAtLocation(p, decl || program.getSourceFiles()[0]);
      if (pt.getCallSignatures().length) continue;
      properties[p.getName()] = schemaOf(pt, depth + 1, next);
      if (!(p.flags & ts.SymbolFlags.Optional)) required.push(p.getName());
    }
    return { type: 'object', properties, ...(required.length ? { required } : {}) };
  }
  return {};
}

const out = {};
for (const sf of program.getSourceFiles()) {
  if (!sf.fileName.endsWith('.controller.ts') || sf.fileName.includes('node_modules')) continue;
  ts.forEachChild(sf, function visit(node) {
    if (ts.isClassDeclaration(node) && node.name) {
      for (const m of node.members) {
        if (!ts.isMethodDeclaration(m)) continue;
        const decos = ts.getDecorators(m) || [];
        if (!decos.some((d) => ts.isCallExpression(d.expression) && HTTP.has(d.expression.expression.getText()))) continue;
        const usesRes = m.parameters.some((p) => (ts.getDecorators(p) || []).some((d) => /^(Res)\(/.test(d.expression.getText())));
        const sig = checker.getSignatureFromDeclaration(m);
        const ret = sig ? checker.getReturnTypeOfSignature(sig) : null;
        out[`${node.name.text}.${m.name.getText()}`] = {
          usesRes,
          typeText: ret ? checker.typeToString(ret, undefined, ts.TypeFormatFlags.NoTruncation).slice(0, 400) : null,
          schema: ret ? schemaOf(ret, 0, new Set()) : {},
        };
      }
    }
  });
}
process.stdout.write(JSON.stringify(out));
