import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
spawnSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
const { default: worker } = await import(pathToFileURL(process.cwd() + '/worker/index.js'));
const port = Number(process.argv[2] || process.env.PORT || 4317);
createServer(async (req, res) => {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 3_000_000) { res.writeHead(413); res.end('Payload too large'); return; } chunks.push(chunk); }
    const request = new Request('http://127.0.0.1:' + port + req.url, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const response = await worker.fetch(request, process.env, {});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Erreur interne du serveur local.' })); console.error(error.message); }
}).listen(port, '127.0.0.1', () => console.log('LushiData ready: http://127.0.0.1:' + port));
