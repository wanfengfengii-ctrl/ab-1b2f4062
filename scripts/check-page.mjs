// 页面可访问检查：静态托管 dist/ 产物，请求首页与其引用的全部资源，
// 任一不可访问即以非零退出码失败。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (p === '/') p = '/index.html';
    const file = normalize(join(dist, p));
    if (!file.startsWith(dist)) throw new Error('path escape');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((resolve) => server.listen(4173, '127.0.0.1', resolve));

try {
  const res = await fetch('http://127.0.0.1:4173/');
  if (res.status !== 200) throw new Error(`首页不可访问：HTTP ${res.status}`);
  const html = await res.text();
  for (const marker of ['id="app"', '纸本文物']) {
    if (!html.includes(marker)) throw new Error(`首页缺少关键标记：${marker}`);
  }

  // 校验首页引用的全部资源（相对或绝对路径）均可访问
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('data:') && !u.startsWith('http'));
  for (const ref of refs) {
    const url = new URL(ref, 'http://127.0.0.1:4173/');
    const r = await fetch(url);
    if (r.status !== 200) throw new Error(`资源不可访问：${ref}（HTTP ${r.status}）`);
    const body = await r.text();
    if (ref.endsWith('.js') && !body.includes('发起复核')) {
      throw new Error(`脚本资源内容异常：${ref}`);
    }
  }
  console.log(`页面可访问检查通过：首页 + ${refs.length} 个引用资源均正常`);
} finally {
  server.close();
}
