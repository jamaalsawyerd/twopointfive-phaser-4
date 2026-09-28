const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');
const esbuild = require('esbuild');
const { buildOptions } = require('./build.js');

const root = __dirname;
const port = Number(process.env.PORT || 8080);
// --live rebuilds on source changes and reloads open Phaser demo tabs; --typecheck runs tsc --watch alongside.
const live = process.argv.includes('--live');
const typecheck = process.argv.includes('--typecheck');

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

// Pages in liveReloadPages get this script injected as they are served; the files on disk stay
// clean. It holds an EventSource open on /__livereload and reloads on `reload`. `hello` carries an
// id unique to this server process, so a tab that reconnects after a restart sees a new id and
// reloads into whatever was built while the server was down. Weltmeister is deliberately absent:
// a reload would discard unsaved level edits.
const liveReloadPages = new Set([path.join(root, 'index.html')]);
const liveReloadClients = new Set();
const serverId = `${process.pid}-${Date.now()}`;
const liveReloadScript = `<script>
  (() => {
    const source = new EventSource('/__livereload');
    let serverId = null;
    source.addEventListener('hello', (event) => {
      if (serverId && serverId !== event.data) location.reload();
      serverId = event.data;
    });
    source.addEventListener('reload', () => location.reload());
    source.addEventListener('build-error', (event) => {
      console.error('[live reload] Build failed; still running the last good build.\\n' + event.data);
    });
  })();
</script>
`;

function broadcast(event, data = '') {
  const payload = data
    .split('\n')
    .map((line) => `data: ${line}`)
    .join('\n');
  for (const client of liveReloadClients) client.write(`event: ${event}\n${payload}\n\n`);
}

function handleLiveReload(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  // A short retry makes tabs reconnect promptly after a restart rather than after the browser default.
  res.write(`retry: 500\nevent: hello\ndata: ${serverId}\n\n`);
  liveReloadClients.add(res);
  req.on('close', () => liveReloadClients.delete(res));
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
  // no-store so a reload always fetches the freshly built bundle rather than a cached copy.
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  if (live && liveReloadPages.has(filePath)) {
    res.end(fs.readFileSync(filePath, 'utf8').replace('</body>', `${liveReloadScript}</body>`));
    return;
  }
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

  if (live && req.method === 'GET' && reqUrl.pathname === '/__livereload') {
    handleLiveReload(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed');
    return;
  }

  serveStatic(reqUrl, res);
});

// Rebuilds dist/game.js whenever a file in the bundle changes, then reloads open tabs, or on failure
// logs the error to their consoles; esbuild writes nothing for a failed build, so the last good
// bundle stays in place. Resolves once the first build is written.
async function startLiveBuild() {
  let firstBuildDone;
  const firstBuild = new Promise((resolve) => (firstBuildDone = resolve));
  const context = await esbuild.context({
    ...buildOptions,
    logLevel: 'info',
    plugins: [
      {
        name: 'live-reload',
        setup(build) {
          build.onEnd((result) => {
            firstBuildDone();
            if (result.errors.length === 0) {
              broadcast('reload');
            } else {
              broadcast('build-error', esbuild.formatMessagesSync(result.errors, { kind: 'error' }).join('\n'));
            }
          });
        },
      },
    ],
  });
  // watch() resolves as soon as watching starts, before the initial build finishes.
  await context.watch();
  await firstBuild;
}

// Reloads open tabs when files outside the bundle change: the live-reload pages and media/.
function watchStaticFiles() {
  let timer = null;
  // Editors often save in several steps (write, then rename), so collapse a burst into one reload.
  const reloadSoon = (file) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`[live] ${file} changed, reloading`);
      broadcast('reload');
    }, 100);
  };
  // Watch the directory rather than the files: an atomic save replaces the file, ending a file watch.
  fs.watch(root, (_event, file) => {
    if (file && liveReloadPages.has(path.join(root, file))) reloadSoon(file);
  });
  fs.watch(path.join(root, 'media'), { recursive: true }, (_event, file) => {
    if (file) reloadSoon(`media/${file.replace(/\\/g, '/')}`);
  });
}

// esbuild only strips types, so type errors come from tsc running in watch mode in the same terminal.
function startTypeCheck() {
  const tsc = spawn(
    process.execPath,
    [require.resolve('typescript/bin/tsc'), '--noEmit', '--watch', '--preserveWatchOutput'],
    { cwd: root, stdio: 'inherit' },
  );
  // node --watch restarts this process with SIGTERM. Left to the default, a signal skips 'exit'
  // handlers and leaves tsc running beside the next one, so exit explicitly and take tsc with us.
  process.on('exit', () => tsc.kill());
  process.on('SIGTERM', () => process.exit());
  process.on('SIGINT', () => process.exit());
}

function listen() {
  server.listen(port, () => {
    console.log(`Serving Phaser at http://localhost:${port}/index.html${live ? ' (live reload)' : ''}`);
    console.log(`Serving Impact demo at http://localhost:${port}/impact-index.html`);
    console.log(`Serving Weltmeister at http://localhost:${port}/weltmeister.html`);
  });
}

if (typecheck) startTypeCheck();
if (live) {
  watchStaticFiles();
  // Listen only once the first build is written, so a tab reconnecting after a restart reloads into it.
  startLiveBuild().then(listen);
} else {
  listen();
}
