const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const root = __dirname;
const port = Number(process.env.PORT || 8080);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function sendJson(res, value) {
  send(res, 200, JSON.stringify(value), 'application/json; charset=utf-8');
}

function safePath(relativePath) {
  const cleanPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\./g, '');
  const resolved = path.resolve(root, cleanPath);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function toRepoPath(absolutePath) {
  return path.relative(root, absolutePath).replace(/\\/g, '/');
}

function walkFiles(startDir) {
  const files = [];
  if (!fs.existsSync(startDir)) return files;
  const entries = fs.readdirSync(startDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{([^}]+)\\\}/g, (_, inner) => `(${inner.split(',').map((part) => part.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|')})`)
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

function matchGlob(pattern) {
  const cleanPattern = pattern.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\./g, '');
  const firstWildcard = cleanPattern.search(/[\*{]/);
  const basePart = firstWildcard === -1 ? cleanPattern : cleanPattern.slice(0, firstWildcard);
  const baseDir = safePath(basePart.slice(0, basePart.lastIndexOf('/') + 1));
  const matcher = globToRegExp(cleanPattern);
  return walkFiles(baseDir || root)
    .map(toRepoPath)
    .filter((file) => matcher.test(file));
}

function handleBrowse(reqUrl, res) {
  const dir = reqUrl.searchParams.get('dir') || '';
  const type = reqUrl.searchParams.get('type') || '';
  const dirPath = safePath(dir);
  if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    sendJson(res, { parent: false, dirs: [], files: [] });
    return;
  }

  let extensions = null;
  if (type === 'images') extensions = new Set(['.png', '.gif', '.jpg', '.jpeg']);
  if (type === 'scripts') extensions = new Set(['.js']);

  const dirs = [];
  const files = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      dirs.push(toRepoPath(entryPath));
    } else if (entry.isFile() && (!extensions || extensions.has(path.extname(entry.name).toLowerCase()))) {
      files.push(toRepoPath(entryPath));
    }
  }

  const normalizedDir = dir.replace(/\\/g, '/').replace(/\/$/, '');
  const parent = normalizedDir ? normalizedDir.slice(0, normalizedDir.lastIndexOf('/')) : false;
  sendJson(res, { parent, dirs: dirs.sort(), files: files.sort() });
}

function handleGlob(reqUrl, res) {
  const globs = reqUrl.searchParams.getAll('glob[]').concat(reqUrl.searchParams.getAll('glob'));
  const files = globs.flatMap(matchGlob);
  sendJson(res, Array.from(new Set(files)).sort());
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleSave(req, res) {
  const body = await readBody(req);
  const params = new URLSearchParams(body);
  const savePath = params.get('path') || '';
  const data = params.get('data') || '';
  const target = safePath(savePath);

  if (!savePath || !data) {
    sendJson(res, { error: '1', msg: 'No Data or Path specified' });
    return;
  }

  if (!target || path.extname(target) !== '.js') {
    sendJson(res, { error: '3', msg: 'File must have a .js suffix' });
    return;
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    sendJson(res, { error: 0 });
  } catch (_error) {
    sendJson(res, { error: '2', msg: `Couldn't write to file: ${target}` });
  }
}

function serveStatic(reqUrl, res) {
  let pathname = decodeURIComponent(reqUrl.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/impact-version/weltmeister.html') pathname = '/weltmeister.html';
  const filePath = safePath(pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, 'Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${port}`}`);

  if (req.method === 'GET' && reqUrl.pathname === '/impact-version/weltmeister/api/browse.php') {
    handleBrowse(reqUrl, res);
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/impact-version/weltmeister/api/glob.php') {
    handleGlob(reqUrl, res);
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/impact-version/weltmeister/api/save.php') {
    handleSave(req, res).catch((error) => sendJson(res, { error: '2', msg: error.message }));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed');
    return;
  }

  serveStatic(reqUrl, res);
});

server.listen(port, () => {
  console.log(`Serving Phaser at http://localhost:${port}/index.html`);
  console.log(`Serving Impact demo at http://localhost:${port}/impact-index.html`);
  console.log(`Serving Weltmeister at http://localhost:${port}/weltmeister.html`);
});
