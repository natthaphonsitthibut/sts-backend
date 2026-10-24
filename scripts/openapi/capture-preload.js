/**
 * Records real request/response pairs for the API documentation examples.
 * Load with: OPENAPI_CAPTURE_FILE=/path/out.jsonl node -r ./scripts/openapi/capture-preload.js ...
 * Each line: { method, route, url, status, requestBody, responseBody, contentType }.
 * Only JSON bodies are kept; nothing is captured unless OPENAPI_CAPTURE_FILE is set.
 */
const fs = require('fs');
const http = require('http');

const OUT = process.env.OPENAPI_CAPTURE_FILE;
if (OUT) {
  const origEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function patchedEmit(event, req, res) {
    if (event === 'request' && res && !res.__captured) {
      res.__captured = true;
      const chunks = [];
      const origWrite = res.write;
      const origEnd = res.end;
      res.write = function (chunk, ...args) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return origWrite.call(this, chunk, ...args);
      };
      res.end = function (chunk, ...args) {
        if (chunk && typeof chunk !== 'function') chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return origEnd.call(this, chunk, ...args);
      };
      res.on('finish', () => {
        try {
          const contentType = String(res.getHeader('content-type') || '');
          let responseBody;
          if (contentType.includes('application/json')) {
            const text = Buffer.concat(chunks).toString('utf8');
            responseBody = text ? JSON.parse(text) : null;
          }
          const route = req.route && req.route.path ? `${req.baseUrl || ''}${req.route.path}` : null;
          const line = {
            method: req.method,
            route,
            url: req.originalUrl || req.url,
            status: res.statusCode,
            requestContentType: String(req.headers['content-type'] || ''),
            requestBody: req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : undefined,
            responseBody,
            contentType,
          };
          fs.appendFileSync(OUT, `${JSON.stringify(line)}\n`);
        } catch {
          // capture must never affect the app
        }
      });
    }
    return origEmit.apply(this, arguments);
  };
}
