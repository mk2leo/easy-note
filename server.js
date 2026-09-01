/**
 * 网上记事簿 - 静态服务器 + 文件上传 + SQLite 数据库存储
 * 监听端口: 8686
 * 启动: node server.js
 *
 * 数据库: 优先使用 node:sqlite (Node 22+)，
 *         若 Node 版本不支持则自动降级为 JSON 文件存储。
 *         两者都把数据保存在服务器硬盘 (data/ 目录)。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8686;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const DELETED_FILE = path.join(DATA_DIR, 'deleted.json'); // 删除墓碑（防止多设备删除复活）

// 确保上传目录和数据库目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ===== 数据库抽象层（SQLite 优先，JSON 降级） =====
let DB_ENGINE = 'json';

function initDB() {
  // 尝试使用 node:sqlite
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(DATA_DIR, 'notesbook.db'));
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        locked INTEGER NOT NULL DEFAULT 0,
        passHash TEXT,
        attachments TEXT NOT NULL DEFAULT '[]',
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shared (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        locked INTEGER NOT NULL DEFAULT 0,
        passHash TEXT,
        sharedAt INTEGER NOT NULL
      );
    `);
    // 舊庫遷移：補充 passHash 列（若已存在則忽略）
    try { db.exec('ALTER TABLE shared ADD COLUMN passHash TEXT'); } catch (e) { /* 已存在 */ }
    DB_ENGINE = 'sqlite';
    return db;
  } catch (e) {
    // node:sqlite 不可用，降级为 JSON 文件
    if (!fs.existsSync(path.join(DATA_DIR, 'notes.json'))) {
      fs.writeFileSync(path.join(DATA_DIR, 'notes.json'), '{}', 'utf-8');
    }
    if (!fs.existsSync(path.join(DATA_DIR, 'shared.json'))) {
      fs.writeFileSync(path.join(DATA_DIR, 'shared.json'), '{}', 'utf-8');
    }
    DB_ENGINE = 'json';
    console.warn('⚠️ node:sqlite 不可用，使用 JSON 文件存储（仍存服务器硬盘）');
    return null;
  }
}

const db = initDB();
const JSON_NOTES = path.join(DATA_DIR, 'notes.json');
const JSON_SHARED = path.join(DATA_DIR, 'shared.json');

// ---------- 記事儲存 ----------

// 讀取所有記事（不帶 passHash 暴露，供列表/前端）
function getAllNotes() {
  if (DB_ENGINE === 'sqlite') {
    const rows = db.prepare('SELECT * FROM notes').all();
    return rows.map(r => ({
      id: r.id, title: r.title, content: r.content,
      locked: !!r.locked, passHash: r.passHash,
      attachments: JSON.parse(r.attachments || '[]'),
      created: r.created, updated: r.updated
    }));
  }
  try {
    return Object.values(JSON.parse(fs.readFileSync(JSON_NOTES, 'utf-8')));
  } catch (e) {
    return [];
  }
}

function getNote(id) {
  if (DB_ENGINE === 'sqlite') {
    const r = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    if (!r) return null;
    return { id: r.id, title: r.title, content: r.content, locked: !!r.locked, passHash: r.passHash, attachments: JSON.parse(r.attachments || '[]'), created: r.created, updated: r.updated };
  }
  try {
    return JSON.parse(fs.readFileSync(JSON_NOTES, 'utf-8'))[id] || null;
  } catch (e) {
    return null;
  }
}

function saveNote(note) {
  if (DB_ENGINE === 'sqlite') {
    db.prepare(`INSERT INTO notes (id, title, content, locked, passHash, attachments, created, updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  title=excluded.title, content=excluded.content, locked=excluded.locked,
                  passHash=excluded.passHash, attachments=excluded.attachments, updated=excluded.updated`)
      .run(note.id, note.title || '', note.content || '', note.locked ? 1 : 0, note.passHash || null,
        JSON.stringify(note.attachments || []), note.created || Date.now(), note.updated || Date.now());
    return;
  }
  const all = JSON.parse(fs.readFileSync(JSON_NOTES, 'utf-8'));
  all[note.id] = note;
  fs.writeFileSync(JSON_NOTES, JSON.stringify(all, null, 2), 'utf-8');
}

function deleteNote(id) {
  if (DB_ENGINE === 'sqlite') {
    db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    return;
  }
  const all = JSON.parse(fs.readFileSync(JSON_NOTES, 'utf-8'));
  delete all[id];
  fs.writeFileSync(JSON_NOTES, JSON.stringify(all, null, 2), 'utf-8');
}

// ---------- 分享儲存 ----------

function getAllShared() {
  if (DB_ENGINE === 'sqlite') {
    const rows = db.prepare('SELECT * FROM shared').all();
    return rows.map(r => ({ id: r.id, title: r.title, content: r.content, locked: !!r.locked, sharedAt: r.sharedAt }));
  }
  try {
    return Object.values(JSON.parse(fs.readFileSync(JSON_SHARED, 'utf-8')));
  } catch (e) {
    return [];
  }
}

function getShared(id) {
  if (DB_ENGINE === 'sqlite') {
    const r = db.prepare('SELECT * FROM shared WHERE id = ?').get(id);
    if (!r) return null;
    return { id: r.id, title: r.title, content: r.content, locked: !!r.locked, passHash: r.passHash || null, sharedAt: r.sharedAt };
  }
  try {
    return JSON.parse(fs.readFileSync(JSON_SHARED, 'utf-8'))[id] || null;
  } catch (e) {
    return null;
  }
}

function saveShared(id, title, content, locked, passHash) {
  if (DB_ENGINE === 'sqlite') {
    db.prepare(`INSERT INTO shared (id, title, content, locked, passHash, sharedAt)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  title=excluded.title, content=excluded.content, locked=excluded.locked, passHash=excluded.passHash, sharedAt=excluded.sharedAt`)
      .run(id, title || '', content || '', locked ? 1 : 0, passHash || null, Date.now());
    return;
  }
  const all = JSON.parse(fs.readFileSync(JSON_SHARED, 'utf-8'));
  all[id] = { id, title: title || '', content: content || '', locked: !!locked, passHash: passHash || null, sharedAt: Date.now() };
  fs.writeFileSync(JSON_SHARED, JSON.stringify(all, null, 2), 'utf-8');
}

function deleteShared(id) {
  if (DB_ENGINE === 'sqlite') {
    db.prepare('DELETE FROM shared WHERE id = ?').run(id);
    return;
  }
  const all = JSON.parse(fs.readFileSync(JSON_SHARED, 'utf-8'));
  delete all[id];
  fs.writeFileSync(JSON_SHARED, JSON.stringify(all, null, 2), 'utf-8');
}

// ---------- 删除墓碑（跨设备删除同步） ----------
function getDeleted() {
  try {
    if (fs.existsSync(DELETED_FILE)) {
      const d = JSON.parse(fs.readFileSync(DELETED_FILE, 'utf-8'));
      return Array.isArray(d) ? d : [];
    }
  } catch (e) { /* ignore */ }
  return [];
}

function markDeleted(id) {
  const list = getDeleted();
  if (!list.includes(id)) {
    list.push(id);
    fs.writeFileSync(DELETED_FILE, JSON.stringify(list, null, 2), 'utf-8');
  }
}

// MIME 类型映射
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.csv': 'text/csv; charset=utf-8',
  '.log': 'text/plain; charset=utf-8'
};

// 文件上传大小限制: 100MB
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(text);
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(obj));
}

// 生成安全的随机文件名
function safeFileName(originalName) {
  const ext = path.extname(originalName || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  const base = path.basename(originalName || 'file', ext)
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  const rand = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return `${base}_${rand}${ext}`;
}

// 讀取 JSON 請求體
function readJsonBody(req, cb) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      cb(null, JSON.parse(Buffer.concat(chunks).toString('utf-8')));
    } catch (e) {
      cb(e, null);
    }
  });
}

const server = http.createServer((req, res) => {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  // ===== 記事接口 (CRUD) =====

  // 新建記事 (POST /api/notes)
  if (urlPath === '/api/notes' && req.method === 'POST') {
    readJsonBody(req, (err, body) => {
      if (err || !body || !body.id) {
        return sendJson(res, 400, { error: '缺少必要的參數' });
      }
      const note = {
        id: body.id,
        title: body.title || '',
        content: body.content || '',
        locked: !!body.locked,
        passHash: body.passHash || null,
        attachments: body.attachments || [],
        created: body.created || Date.now(),
        updated: body.updated || Date.now()
      };
      saveNote(note);
      sendJson(res, 200, { ok: true, id: note.id });
    });
    return;
  }

  // 列出所有記事 (GET /api/notes)
  if (urlPath === '/api/notes' && req.method === 'GET') {
    const notes = getAllNotes();
    // 列表唔帶內容同密碼，節省流量
    const list = notes.map(n => ({
      id: n.id, title: n.title, locked: !!n.locked,
      created: n.created, updated: n.updated
    }));
    sendJson(res, 200, { ok: true, list, deleted: getDeleted() });
    return;
  }

  // 更新記事 (PUT /api/notes/:id)
  if (urlPath.startsWith('/api/notes/') && req.method === 'PUT') {
    const id = decodeURIComponent(urlPath.replace('/api/notes/', ''));
    readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'JSON 格式錯誤' });
      const existing = getNote(id);
      if (!existing) return sendJson(res, 404, { error: '記事唔存在' });
      const updated = {
        ...existing,
        title: body.title !== undefined ? body.title : existing.title,
        content: body.content !== undefined ? body.content : existing.content,
        locked: body.locked !== undefined ? !!body.locked : existing.locked,
        passHash: body.passHash !== undefined ? body.passHash : existing.passHash,
        attachments: body.attachments !== undefined ? body.attachments : existing.attachments,
        updated: Date.now()
      };
      saveNote(updated);
      sendJson(res, 200, { ok: true, id });
    });
    return;
  }

  // 讀取單篇記事 (GET /api/notes/:id)
  if (urlPath.startsWith('/api/notes/') && req.method === 'GET') {
    const id = decodeURIComponent(urlPath.replace('/api/notes/', ''));
    const note = getNote(id);
    if (!note) return sendJson(res, 404, { error: '記事唔存在' });
    sendJson(res, 200, { ok: true, note });
    return;
  }

  // 刪除記事 (DELETE /api/notes/:id)
  if (urlPath.startsWith('/api/notes/') && req.method === 'DELETE') {
    const id = decodeURIComponent(urlPath.replace('/api/notes/', ''));
    deleteNote(id);
    deleteShared(id); // 順便刪埋分享
    markDeleted(id);  // 記錄墓碑，防止其他設備把已刪筆記重新上傳復活
    sendJson(res, 200, { ok: true });
    return;
  }

  // ===== 分享接口 =====

  // 開啟 / 更新分享 (POST /api/share)
  if (urlPath === '/api/share' && req.method === 'POST') {
    readJsonBody(req, (err, body) => {
      if (err || !body || !body.id) {
        return sendJson(res, 400, { error: '缺少必要的參數' });
      }
      const { id, title, content, locked, passHash } = body;
      if (!title && !content) {
        return sendJson(res, 400, { error: '分享內容為空' });
      }
      saveShared(id, title || '（無標題）', content || '', !!locked, passHash || null);
      sendJson(res, 200, { ok: true, id, url: `/share.html?id=${encodeURIComponent(id)}` });
    });
    return;
  }

  // 取消分享 (DELETE /api/share/:id)
  if (urlPath.startsWith('/api/share/') && req.method === 'DELETE') {
    const id = decodeURIComponent(urlPath.replace('/api/share/', ''));
    if (getShared(id)) {
      deleteShared(id);
      sendJson(res, 200, { ok: true });
    } else {
      sendJson(res, 404, { error: '分享唔存在' });
    }
    return;
  }

  // 讀取單篇分享 (GET /api/share/:id)
  if (urlPath.startsWith('/api/share/') && req.method === 'GET') {
    const id = decodeURIComponent(urlPath.replace('/api/share/', ''));
    const s = getShared(id);
    if (s) {
      // 鎖定分享：不下發內容，需先通過 /api/share/verify 驗證密碼
      const payload = { ok: true, title: s.title, locked: s.locked, sharedAt: s.sharedAt };
      if (!s.locked) payload.content = s.content;
      sendJson(res, 200, payload);
    } else {
      sendJson(res, 404, { error: '分享唔存在或已取消' });
    }
    return;
  }

  // 驗證鎖定分享密碼 (POST /api/share/verify) — body: {id, hash}
  if (urlPath === '/api/share/verify' && req.method === 'POST') {
    readJsonBody(req, (err, body) => {
      if (err || !body || !body.id || !body.hash) {
        return sendJson(res, 400, { error: '缺少必要的參數' });
      }
      const s = getShared(body.id);
      if (!s) {
        return sendJson(res, 404, { error: '分享唔存在或已取消' });
      }
      if (!s.locked) {
        return sendJson(res, 200, { ok: true, match: true, content: s.content, title: s.title, sharedAt: s.sharedAt });
      }
      if (!s.passHash) {
        // 舊版分享無密碼哈希：無法驗證，拒絕（避免內容泄露）
        return sendJson(res, 200, { ok: true, match: false });
      }
      if (s.passHash === body.hash) {
        sendJson(res, 200, { ok: true, match: true, content: s.content, title: s.title, sharedAt: s.sharedAt });
      } else {
        sendJson(res, 200, { ok: true, match: false });
      }
    });
    return;
  }

  // 列出所有分享中筆記 (GET /api/shared)
  if (urlPath === '/api/shared' && req.method === 'GET') {
    const list = getAllShared().map(s => ({ id: s.id, title: s.title, locked: !!s.locked, sharedAt: s.sharedAt }));
    sendJson(res, 200, { ok: true, list });
    return;
  }

  // ===== 上传接口 =====
  if (urlPath === '/api/upload' && req.method === 'POST') {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_SIZE) {
        req.destroy();
        sendJson(res, 413, { error: '文件过大，超过 100MB 限制' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        // 解析 multipart/form-data
        const boundaryMatch = contentType.match(/boundary=(.+)$/);
        if (!boundaryMatch) {
          return sendJson(res, 400, { error: '格式错误：缺少 boundary' });
        }
        const boundary = boundaryMatch[1];
        const parts = splitMultipart(body, boundary);
        let fileBuffer = null;
        let originalName = 'file';

        for (const part of parts) {
          const headerStr = part.headers.toString('utf-8');
          const nameMatch = headerStr.match(/name="([^"]*)"/);
          const filenameMatch = headerStr.match(/filename="([^"]*)"/);
          if (filenameMatch) {
            originalName = filenameMatch[1];
            fileBuffer = part.data;
          }
        }

        if (!fileBuffer) {
          return sendJson(res, 400, { error: '未收到文件内容' });
        }

        const safeName = safeFileName(originalName);
        const filePath = path.join(UPLOAD_DIR, safeName);
        fs.writeFileSync(filePath, fileBuffer);
        sendJson(res, 200, {
          ok: true,
          url: `/uploads/${safeName}`,
          name: originalName,
          size: fileBuffer.length
        });
      } catch (e) {
        sendJson(res, 500, { error: '上传失败: ' + e.message });
      }
    });
    return;
  }

  // ===== 静态文件服务 =====
  // 防目录穿越
  const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, relPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return sendText(res, 404, 'Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(filePath).pipe(res);
  });
});

// multipart 解析器
function splitMultipart(body, boundary) {
  const boundaryBuf = Buffer.from('--' + boundary);
  const parts = [];
  let index = body.indexOf(boundaryBuf);

  while (index !== -1) {
    // 找头部结束 (空行)
    const headerEnd = body.indexOf('\r\n\r\n', index + boundaryBuf.length);
    if (headerEnd === -1) break;

    const headers = body.slice(index + boundaryBuf.length + 2, headerEnd); // 跳过 --\r\n
    const dataStart = headerEnd + 4;
    // 找下一个 boundary
    const nextIndex = body.indexOf(boundaryBuf, dataStart);
    if (nextIndex === -1) break;

    let data = body.slice(dataStart, nextIndex);
    // 去掉末尾 \r\n
    if (data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 10) {
      data = data.slice(0, data.length - 2);
    }

    parts.push({ headers, data });
    index = nextIndex;
  }
  return parts;
}

server.listen(PORT, () => {
  console.log(`📒 网上记事簿已启动`);
  console.log(`   ➜ 本地访问: http://localhost:${PORT}`);
  console.log(`   ➜ 数据库引擎: ${DB_ENGINE === 'sqlite' ? 'SQLite' : 'JSON 文件'}`);
  console.log(`   ➜ 数据目录: ${DATA_DIR}`);
  console.log(`   ➜ 上传目录: ${UPLOAD_DIR}`);
});
