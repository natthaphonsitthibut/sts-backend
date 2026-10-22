/**
 * Reads every controller with the TypeScript compiler and lists, per endpoint:
 * HTTP method + full paths, auth/permission/role decorators, rate-limit decorators,
 * explicit status code, parameters, and the HTTP exceptions the handler (and the
 * service methods it calls, two levels deep) can throw.
 *   node scripts/openapi/extract-controllers.js > out.json
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SRC = path.join(__dirname, '..', '..', 'src');
const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) files.push(full);
  }
})(SRC);

const sources = new Map(files.map((f) => [f, ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true)]));
const classes = new Map(); // name -> {node, sf}
const consts = new Map(); // exported string consts
for (const [file, sf] of sources) {
  ts.forEachChild(sf, function visit(node) {
    if (ts.isClassDeclaration(node) && node.name) classes.set(node.name.text, { node, sf, file });
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (d.initializer && ts.isStringLiteral(d.initializer) && ts.isIdentifier(d.name)) consts.set(d.name.text, d.initializer.text);
      }
    }
  });
}

const decs = (node) => (ts.canHaveDecorators(node) ? ts.getDecorators(node) || [] : []);
function decName(d) {
  const e = d.expression;
  if (ts.isCallExpression(e)) return e.expression.getText();
  return e.getText();
}
function litValue(n) {
  if (!n) return undefined;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (ts.isIdentifier(n) && consts.has(n.text)) return consts.get(n.text);
  if (ts.isArrayLiteralExpression(n)) return n.elements.map(litValue);
  if (ts.isPropertyAccessExpression(n)) return n.getText();
  return n.getText();
}
function decArgs(d) {
  return ts.isCallExpression(d.expression) ? d.expression.arguments.map(litValue) : [];
}
const EXC = {
  BadRequestException: 400, UnauthorizedException: 401, ForbiddenException: 403, NotFoundException: 404,
  ConflictException: 409, GoneException: 410, PayloadTooLargeException: 413, UnsupportedMediaTypeException: 415,
  UnprocessableEntityException: 422, TooManyRequestsException: 429, InternalServerErrorException: 500,
  BadGatewayException: 502, ServiceUnavailableException: 503, NotImplementedException: 501,
};
function fieldTypes(cls) {
  const out = {};
  for (const m of cls.members) {
    if (ts.isConstructorDeclaration(m)) {
      for (const p of m.parameters) if (p.type && ts.isIdentifier(p.name)) out[p.name.text] = p.type.getText();
    }
    if (ts.isPropertyDeclaration(m) && m.type && ts.isIdentifier(m.name)) out[m.name.text] = m.type.getText();
  }
  return out;
}
function method(cls, name) {
  return cls.members.find((m) => (ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m)) && m.name && m.name.getText() === name);
}
function exceptions(clsName, methodName, depth, seen) {
  const key = `${clsName}.${methodName}`;
  if (seen.has(key) || depth < 0) return new Set();
  seen.add(key);
  const c = classes.get(clsName);
  if (!c) return new Set();
  const m = method(c.node, methodName);
  if (!m) return new Set();
  const out = new Set();
  const fields = fieldTypes(c.node);
  (function walk(n) {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && EXC[n.expression.text]) out.add(EXC[n.expression.text]);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const target = n.expression.expression; const callee = n.expression.name.text;
      if (target.kind === ts.SyntaxKind.ThisKeyword) for (const x of exceptions(clsName, callee, depth, seen)) out.add(x);
      else if (ts.isPropertyAccessExpression(target) && target.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const t = fields[target.name.text];
        if (t) for (const x of exceptions(t.replace(/<.*/, ''), callee, depth - 1, seen)) out.add(x);
      }
    }
    ts.forEachChild(n, walk);
  })(m);
  return out;
}
const HTTP = ['Get', 'Post', 'Put', 'Patch', 'Delete'];
const result = [];
for (const [name, { node, file }] of classes) {
  const cdec = decs(node).find((d) => decName(d) === 'Controller');
  if (!cdec) continue;
  let prefixes = decArgs(cdec)[0];
  prefixes = prefixes === undefined ? [''] : Array.isArray(prefixes) ? prefixes : [prefixes];
  const classDecs = decs(node).map((d) => ({ name: decName(d), args: decArgs(d) }));
  for (const m of node.members) {
    if (!ts.isMethodDeclaration(m)) continue;
    const md = decs(m).map((d) => ({ name: decName(d), args: decArgs(d) }));
    const http = md.find((d) => HTTP.includes(d.name));
    if (!http) continue;
    let sub = http.args[0];
    const subs = sub === undefined ? [''] : Array.isArray(sub) ? sub : [sub];
    const paths = [];
    for (const p of prefixes) for (const s of subs) paths.push(('/' + [p, s].filter((x) => x).join('/')).replace(/\/+/g, '/').replace(/:(\w+)/g, '{$1}'));
    const params = m.parameters.map((p) => ({
      name: p.name.getText(),
      type: p.type ? p.type.getText() : undefined,
      decorators: decs(p).map((d) => ({ name: decName(d), args: decArgs(d) })),
    }));
    result.push({
      controller: name, method: m.name.getText(), file: path.relative(SRC, file), http: http.name.toUpperCase(), paths,
      classDecorators: classDecs.filter((d) => d.name !== 'Controller'), decorators: md.filter((d) => d !== http), params,
      exceptions: [...exceptions(name, m.name.getText(), 2, new Set())].sort(),
    });
  }
}
process.stdout.write(JSON.stringify(result, null, 1));
