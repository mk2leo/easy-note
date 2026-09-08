/* ===== 網上記事簿 - 前端邏輯 ===== */

// ---------- 密碼哈希工具（Web Crypto SHA-256） ----------
async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- 狀態 ----------
let notes = [];          // [{id,title,content,locked,passHash,attachments,created,updated}]
let currentId = null;    // 當前選中記事 id
let unlocked = {};       // 已解鎖的記事 id 集合
let sharedNotes = {};    // 分享中嘅記事 id → {url} 集合
let previewMode = false; // 預覽模式

// localStorage key
const STORE_KEY = 'notesbook_notes_v1';

// DOM
const $ = id => document.getElementById(id);
const els = {
  noteList: $('noteList'),
  emptyHint: $('emptyHint'),
  noteCount: $('noteCount'),
  content: $('content'),
  placeholder: $('placeholder'),
  noteEditor: $('noteEditor'),
  btnNewNote: $('btnNewNote'),
  btnDelete: $('btnDelete'),
  btnPreview: $('btnPreview'),
  btnSave: $('btnSave'),
  btnShare: $('btnShare'),
  fileImage: $('fileImage'),
  fileDoc: $('fileDoc'),
  lockSwitch: $('lockSwitch'),
  lockBar: $('lockBar'),
  lockPassword: $('lockPassword'),
  lockConfirm: $('lockConfirm'),
  noteTitle: $('noteTitle'),
  noteBody: $('noteBody'),
  preview: $('preview'),
  imgStrip: $('imgStrip'),
  imgStripList: $('imgStripList'),
  attachments: $('attachments'),
  attList: $('attList'),
  divider: $('divider'),
  unlockModal: $('unlockModal'),
  unlockInput: $('unlockInput'),
  unlockError: $('unlockError'),
  btnUnlockCancel: $('btnUnlockCancel'),
  btnUnlockOk: $('btnUnlockOk'),
  shareModal: $('shareModal'),
  shareModalTitle: $('shareModalTitle'),
  shareModalSub: $('shareModalSub'),
  shareUrl: $('shareUrl'),
  shareLockWarn: $('shareLockWarn'),
  shareNote: $('shareNote'),
  btnShareClose: $('btnShareClose'),
  btnUnshare: $('btnUnshare'),
  btnCopyUrl: $('btnCopyUrl'),
};

// ---------- 儲存 / 載入（伺服器資料庫） ----------

// 把 notes 陣列寫回 localStorage（離線可用 + 下次刷新更快）
function setStore(notesList) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(notesList));
  } catch (e) { /* ignore */ }
}

// 合併伺服器與 localStorage 數據：伺服器優先，localStorage 獨有者上傳到伺服器
// 已棄用的引導記事標題（localStorage 殘留時跳過，唔再上傳）
const LEGACY_SEED_TITLES = new Set(['👋 歡迎使用網上記事簿']);

async function mergeAndSync(serverNotes, localNotes, deletedIds) {
  const serverMap = new Map();
  for (const n of serverNotes) serverMap.set(n.id, n);
  const deletedSet = deletedIds || new Set();

  const toUpload = [];
  for (const n of localNotes) {
    // 跳過已棄用的引導記事
    if (LEGACY_SEED_TITLES.has(n.title)) continue;
    // 已被其他設備刪除（伺服器墓碑）→ 唔恢復、唔上傳
    if (deletedSet.has(n.id)) continue;
    if (!serverMap.has(n.id)) {
      // 本地獨有（非墓碑）→ 補上時間戳後上傳
      toUpload.push({
        id: n.id,
        title: n.title || '',
        content: n.content || '',
        locked: !!n.locked,
        passHash: n.passHash || null,
        attachments: n.attachments || [],
        created: n.created || Date.now(),
        updated: n.updated || Date.now()
      });
    }
  }

  if (toUpload.length > 0) {
    try {
      const ops = toUpload.map(n =>
        fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(n)
        })
      );
      await Promise.all(ops);
      // 重新載入伺服器完整數據（確保拿回 upsert 後的最新版本）
      const resp = await fetch('/api/notes');
      const data = await resp.json();
      if (data.ok && data.list) {
        const fullNotes = await Promise.all(data.list.map(async n => {
          try {
            const r = await fetch('/api/notes/' + encodeURIComponent(n.id));
            const d = await r.json();
            return d.ok ? d.note : null;
          } catch (e) { return null; }
        }));
        return fullNotes.filter(Boolean);
      }
    } catch (e) {
      console.warn('合併上傳失敗', e);
    }
  }

  return serverNotes;
}

// 把整個 notes 陣列同步到伺服器（逐筆 upsert）
async function saveNotes() {
  try {
    const ops = notes.map(note =>
      fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: note.id,
          title: note.title,
          content: note.content,
          locked: !!note.locked,
          passHash: note.passHash || null,
          attachments: note.attachments || [],
          created: note.created,
          updated: note.updated
        })
      })
    );
    await Promise.all(ops);
  } catch (e) {
    console.warn('儲存到伺服器失敗', e);
  }
  // 同時寫回 localStorage（離線可用 + 下次刷新更快）
  setStore(notes);
}

// 從伺服器載入記事；同時與 localStorage 舊數據合併，確保多設備同步
async function loadNotes() {
  let serverNotes = [];
  let localNotes = [];
  let deletedIds = new Set();

  // 1. 載入伺服器數據
  try {
    const resp = await fetch('/api/notes');
    const data = await resp.json();
    if (data.ok && data.list) {
      const fullNotes = await Promise.all(data.list.map(async n => {
        try {
          const r = await fetch('/api/notes/' + encodeURIComponent(n.id));
          const d = await r.json();
          return d.ok ? d.note : null;
        } catch (e) { return null; }
      }));
      serverNotes = fullNotes.filter(Boolean);
      // 讀取刪除墓碑：已被刪除的 id，本地有嘅都要跟住刪
      if (Array.isArray(data.deleted)) deletedIds = new Set(data.deleted);
    }
  } catch (e) {
    console.warn('載入伺服器數據失敗', e);
  }

  // 2. 讀取 localStorage 舊數據
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const old = JSON.parse(raw);
      if (Array.isArray(old) && old.length > 0) {
        localNotes = old;
      }
    }
  } catch (e) { /* ignore */ }

  // 3. 合併：伺服器優先，本地獨有者上傳（墓碑除外），本地被刪者移除
  notes = await mergeAndSync(serverNotes, localNotes, deletedIds);

  // 4. 寫回 localStorage（離線可用 + 下次刷新更快）
  setStore(notes);
}

// ---------- 工具 ----------
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-HK', { month: '2-digit', day: '2-digit' });
}

// ---------- 渲染左頁列表 ----------
function renderList() {
  els.noteList.innerHTML = '';
  if (notes.length === 0) {
    els.emptyHint.classList.remove('hidden');
  } else {
    els.emptyHint.classList.add('hidden');
  }
  els.noteCount.textContent = `${notes.length} 篇`;

  // 按更新時間排序
  const sorted = [...notes].sort((a, b) => (b.updated || 0) - (a.updated || 0));
  for (const note of sorted) {
    const item = document.createElement('div');
    item.className = 'note-item' + (note.id === currentId ? ' active' : '');
    item.dataset.id = note.id;

    const lockIco = document.createElement('span');
    lockIco.className = 'lock-ico';
    lockIco.textContent = note.locked ? '🔒' : '';

    // 分享狀態圖示
    const shareIco = document.createElement('span');
    shareIco.className = 'share-ico';
    shareIco.textContent = sharedNotes[note.id] ? '🔗' : '';
    shareIco.title = sharedNotes[note.id] ? '分享中' : '';

    const title = document.createElement('span');
    title.className = 'item-title';
    title.textContent = note.title || '（無標題）';

    const time = document.createElement('span');
    time.className = 'item-time';
    time.textContent = fmtTime(note.updated || note.created);

    item.appendChild(lockIco);
    item.appendChild(shareIco);
    item.appendChild(title);
    item.appendChild(time);

    item.addEventListener('click', () => selectNote(note.id));
    els.noteList.appendChild(item);
  }
}

// ---------- 選中記事 ----------
function selectNote(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;

  currentId = id;
  renderList();

  // 顯示編輯器
  els.placeholder.classList.add('hidden');
  els.noteEditor.classList.remove('hidden');

  // 若鎖定且未解鎖 → 顯示解鎖彈窗，鎖住內容
  if (note.locked && !unlocked[id]) {
    showUnlockModal(id);
    fillLockedEditor(note);
  } else {
    fillEditor(note);
  }
}

// 鎖定狀態下填內容（內容隱藏）
function fillLockedEditor(note) {
  els.noteTitle.value = note.title || '';
  els.noteBody.value = '';
  els.noteBody.placeholder = '🔒 呢篇記事已鎖定，解鎖後先可以檢視同編輯內容。';
  els.noteBody.disabled = true;
  els.noteTitle.disabled = true;
  els.lockSwitch.checked = true;
  els.lockBar.classList.remove('hidden');
  els.lockPassword.value = '';
  els.lockConfirm.value = '';
  renderPreview('🔒 **呢篇記事已鎖定，請解鎖後檢視內容。**');
  renderAttachments(note);
  updateShareBtn();
}

// 解鎖後填內容
function fillEditor(note) {
  els.noteTitle.value = note.title || '';
  els.noteTitle.disabled = false;
  els.noteBody.value = note.content || '';
  els.noteBody.disabled = false;
  els.noteBody.placeholder = '用 Markdown 書寫內容...';
  els.lockSwitch.checked = !!note.locked;

  if (note.locked) {
    els.lockBar.classList.remove('hidden');
    els.lockPassword.value = '';
    els.lockConfirm.value = '';
  } else {
    els.lockBar.classList.add('hidden');
  }

  if (previewMode) renderPreview(note.content);
  renderAttachments(note);
  updateImgStrip();
  updateShareBtn();
}

// ---------- 預覽渲染 ----------
function renderPreview(mdText) {
  if (typeof marked === 'undefined') return;
  const html = marked.parse(mdText || '', { breaks: true, gfm: true });
  els.preview.innerHTML = html;
  // 代碼高亮
  els.preview.querySelectorAll('pre code').forEach(block => {
    if (typeof hljs !== 'undefined') hljs.highlightElement(block);
  });
  // 讓附件中的上傳圖片正常顯示
}

// 更新編輯模式下嘅圖片即時縮圖列（貼上圖片後直接顯示，唔使切預覽）
function updateImgStrip() {
  if (!els.imgStrip || !els.imgStripList) return;
  // 僅喺編輯模式（非預覽）顯示
  if (previewMode) {
    els.imgStrip.classList.add('hidden');
    return;
  }
  const text = els.noteBody.value || '';
  // 找出所有 Markdown 圖片 ![](url) 同 HTML <img>
  const urls = [];
  const mdRe = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = mdRe.exec(text))) {
    const url = m[1].trim();
    if (url && urls.indexOf(url) === -1) urls.push(url);
  }
  // 偵測純圖片 URL（http/https 或 /uploads/，且係圖片副檔名；data:image 亦當圖片）
  const ext = /\.(png|jpe?g|gif|webp|svg|bmp|ico)([?#]\S*)?$/i;
  const imgRe = /(https?:\/\/[^\s)\]]+|data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/g;
  while ((m = imgRe.exec(text))) {
    const url = m[0].trim();
    if (!url) continue;
    const isData = url.startsWith('data:image');
    const isImgExt = ext.test(url.split(')')[0].split(' ')[0]);
    if (!isData && !isImgExt) continue;
    if (urls.indexOf(url) === -1) urls.push(url);
  }

  if (urls.length === 0) {
    els.imgStrip.classList.add('hidden');
    els.imgStripList.innerHTML = '';
    return;
  }

  els.imgStrip.classList.remove('hidden');
  els.imgStripList.innerHTML = '';
  urls.forEach(url => {
    const item = document.createElement('div');
    item.className = 'strip-item';
    item.title = '撳一下喺預覽睇大圖';
    const img = document.createElement('img');
    img.src = url;
    img.loading = 'lazy';
    img.onerror = () => item.remove();
    // 撳縮圖 → 自動切去預覽模式
    item.addEventListener('click', () => {
      if (!previewMode) togglePreview();
    });
    item.appendChild(img);
    els.imgStripList.appendChild(item);
  });
}

// 切換預覽模式（供縮圖撳擊用）
function togglePreview() {
  previewMode = !previewMode;
  if (previewMode) {
    const note = notes.find(n => n.id === currentId);
    if (note && !(note.locked && !unlocked[currentId])) {
      renderPreview(els.noteBody.value);
    }
    els.preview.classList.remove('hidden');
    els.noteBody.classList.add('hidden');
    els.imgStrip.classList.add('hidden');
    els.btnPreview.style.opacity = '1';
  } else {
    els.preview.classList.add('hidden');
    els.noteBody.classList.remove('hidden');
    els.btnPreview.style.opacity = '0.6';
    updateImgStrip();
  }
}

// ---------- 分享 ----------

// 更新分享按鈕 UI（按當前記事嘅分享狀態）
function updateShareBtn() {
  if (!currentId || !els.btnShare) return;
  if (sharedNotes[currentId]) {
    els.btnShare.textContent = '🔗 取消分享';
    els.btnShare.classList.add('on');
    els.btnShare.title = '取消分享';
  } else {
    els.btnShare.textContent = '🔗 分享';
    els.btnShare.classList.remove('on');
    els.btnShare.title = '分享 / 取消分享';
  }
}

// 從伺服器刷新分享狀態
async function refreshShareState() {
  try {
    const resp = await fetch('/api/shared');
    const data = await resp.json();
    sharedNotes = {};
    if (data.ok && data.list) {
      data.list.forEach(s => { sharedNotes[s.id] = true; });
    }
  } catch (e) {
    sharedNotes = {};
  }
  renderList();
  updateShareBtn();
}

// 開啟 / 更新分享
async function shareNote(note) {
  const payload = {
    id: note.id,
    title: note.title || '',
    content: note.content || '',
    locked: !!note.locked,
    passHash: note.passHash || null
  };
  const resp = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await resp.json();
  if (data.ok) {
    sharedNotes[note.id] = true;
    renderList();
    updateShareBtn();
    return data;
  }
  throw new Error(data.error || '分享失敗');
}

// 取消分享
async function unshareNote(id) {
  const resp = await fetch('/api/share/' + encodeURIComponent(id), { method: 'DELETE' });
  const data = await resp.json();
  if (data.ok) {
    delete sharedNotes[id];
    renderList();
    updateShareBtn();
    return true;
  }
  throw new Error(data.error || '取消分享失敗');
}

// 顯示分享彈窗
async function openShareModal() {
  const note = notes.find(n => n.id === currentId);
  if (!note) return;

  // 若未分享 → 先開啟分享
  if (!sharedNotes[currentId]) {
    try {
      await shareNote(note);
    } catch (e) {
      alert('分享失敗：' + e.message);
      return;
    }
  }

  const shareUrl = location.origin + '/share.html?id=' + encodeURIComponent(currentId);
  els.shareUrl.value = shareUrl;
  els.shareModalTitle.textContent = note.locked ? '🔗 已分享（內容鎖定）' : '🔗 分享成功';
  els.shareModalSub.textContent = '複製連結，將呢篇記事分享俾其他人';
  els.shareNote.textContent = '分享後，任何人打開條連結都可以睇到內容；可隨時取消分享。';
  els.shareLockWarn.classList.toggle('hidden', !note.locked);
  els.shareModal.classList.remove('hidden');
  setTimeout(() => els.shareUrl.select(), 50);
}

function closeShareModal() {
  els.shareModal.classList.add('hidden');
}

// ---------- 附件渲染 ----------
function renderAttachments(note) {
  if (!note.attachments || note.attachments.length === 0) {
    els.attachments.classList.add('hidden');
    return;
  }
  els.attachments.classList.remove('hidden');
  els.attList.innerHTML = '';
  note.attachments.forEach(att => {
    const item = document.createElement('div');
    item.className = 'att-item';

    // 下載圖標（放在文件名左邊，與刪除按鈕分開）
    const link = document.createElement('a');
    link.href = att.url;
    link.target = '_blank';
    link.textContent = '⬇';
    link.title = '下載';

    const name = document.createElement('span');
    name.className = 'att-name';
    name.textContent = att.name;
    name.title = att.name;

    const del = document.createElement('span');
    del.className = 'att-del';
    del.textContent = '✕';
    del.title = '移除附件';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeAttachment(att.id, att.name);
    });

    item.appendChild(link);
    item.appendChild(name);
    item.appendChild(del);
    els.attList.appendChild(item);
  });
}

// ---------- 新增記事 ----------
async function newNote() {
  const note = {
    id: uid(),
    title: '',
    content: '',
    locked: false,
    passHash: null,
    attachments: [],
    created: Date.now(),
    updated: Date.now(),
  };
  notes.push(note);
  currentId = note.id;
  previewMode = false;
  saveNotes();
  renderList();
  els.placeholder.classList.add('hidden');
  els.noteEditor.classList.remove('hidden');
  fillEditor(note);
  els.noteTitle.focus();
}

// ---------- 刪除記事 ----------
function deleteNote() {
  if (!currentId) return;
  const note = notes.find(n => n.id === currentId);
  const title = note && note.title ? `「${note.title}」` : '呢篇記事';
  if (!confirm(`確定要刪除 ${title} 嗎？\n呢個操作無法復原。`)) return;

  const idToDelete = currentId;
  notes = notes.filter(n => n.id !== currentId);
  delete unlocked[currentId];
  delete sharedNotes[currentId];
  currentId = null;
  // 同步寫回 localStorage（避免刷新後 localStorage 殘留把已刪記事重新上傳）
  setStore(notes);
  // 刪除伺服器資料
  fetch('/api/notes/' + encodeURIComponent(idToDelete), { method: 'DELETE' })
    .catch(e => console.warn('刪除失敗', e));
  renderList();
  els.noteEditor.classList.add('hidden');
  els.placeholder.classList.remove('hidden');
}

// ---------- 儲存 ----------
async function saveCurrent() {
  const note = notes.find(n => n.id === currentId);
  if (!note) return;

  // 校驗密碼
  const wantLock = els.lockSwitch.checked;
  if (wantLock) {
    const pwd = els.lockPassword.value;
    const confirm = els.lockConfirm.value;
    if (!pwd) {
      alert('請輸入解鎖密碼，或者關閉密碼保護。');
      return false;
    }
    if (pwd !== confirm) {
      alert('兩次輸入嘅密碼不一致，請重新輸入。');
      return false;
    }
    if (pwd.length < 4) {
      alert('密碼長度至少 4 位。');
      return false;
    }
    // 只有開啟鎖時才更新密碼（避免每次保存都改）
    note.passHash = await sha256(pwd);
    note.locked = true;
    unlocked[currentId] = true;
    els.lockBar.classList.remove('hidden');
  } else {
    note.locked = false;
    note.passHash = null;
    // 解鎖狀態保持
  }

  note.title = els.noteTitle.value.trim();
  note.content = els.noteBody.value;
  note.updated = Date.now();
  saveNotes();
  renderList();
  return true;
}

// ---------- 移除附件 ----------
function removeAttachment(attId, attName) {
  const note = notes.find(n => n.id === currentId);
  if (!note) return;
  const name = attName || '附件';
  if (!confirm(`確定要移除附件「${name}」嗎？`)) return;
  note.attachments = (note.attachments || []).filter(a => a.id !== attId);
  note.updated = Date.now();
  saveNotes();
  renderAttachments(note);
}

// ---------- 上傳文件 ----------
// 上傳單個文件，返回 { ok, url, name, size }；會自動加入附件列表
async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const resp = await fetch('/api/upload', { method: 'POST', body: fd });
  const result = await resp.json();
  if (result.ok) {
    const note = notes.find(n => n.id === currentId);
    if (note) {
      const isImage = file.type.startsWith('image/');
      const att = { id: uid(), name: result.name, url: result.url, type: isImage ? 'image' : 'file', size: result.size };
      note.attachments = note.attachments || [];
      note.attachments.push(att);
      note.updated = Date.now();
      saveNotes();
      renderAttachments(note);
    }
    return { ok: true, ...result };
  }
  return { ok: false, error: result.error || '未知錯誤', name: file.name };
}

async function uploadFiles(files) {
  if (!files || files.length === 0) return;
  if (!currentId) return;

  showUploading(`上傳中 ${files.length} 個檔案...`);
  for (const file of files) {
    const isImage = file.type.startsWith('image/');
    try {
      const result = await uploadFile(file);
      if (!result.ok) {
        alert(`上傳「${file.name}」失敗：${result.error || '未知錯誤'}`);
      } else if (isImage && !previewMode) {
        // 圖片：同時插入 markdown 到內容（追加到末尾）
        const md = els.noteBody.value;
        const line = `\n![${file.name}](${result.url})\n`;
        els.noteBody.value = md + line;
        const note = notes.find(n => n.id === currentId);
        if (note) note.content = els.noteBody.value;
      }
    } catch (e) {
      alert(`上傳「${file.name}」出錯：${e.message}`);
    }
  }
  hideUploading();
}

// ---------- 上傳提示 ----------
let uploadingEl = null;
function showUploading(text) {
  if (uploadingEl) uploadingEl.remove();
  uploadingEl = document.createElement('div');
  uploadingEl.className = 'uploading';
  uploadingEl.textContent = text;
  document.body.appendChild(uploadingEl);
}
function hideUploading() {
  if (uploadingEl) { uploadingEl.remove(); uploadingEl = null; }
}

// ---------- 解鎖彈窗 ----------
let pendingUnlockId = null;
function showUnlockModal(id) {
  pendingUnlockId = id;
  els.unlockInput.value = '';
  els.unlockError.textContent = '';
  els.unlockModal.classList.remove('hidden');
  setTimeout(() => els.unlockInput.focus(), 50);
}
function hideUnlockModal() {
  els.unlockModal.classList.add('hidden');
  pendingUnlockId = null;
}
async function tryUnlock() {
  if (!pendingUnlockId) return;
  const pwd = els.unlockInput.value;
  const note = notes.find(n => n.id === pendingUnlockId);
  if (!note) { hideUnlockModal(); return; }

  const hash = await sha256(pwd);
  if (hash === note.passHash) {
    unlocked[pendingUnlockId] = true;
    hideUnlockModal();
    fillEditor(note);
  } else {
    els.unlockError.textContent = '❌ 密碼錯誤，請重試';
    els.unlockInput.select();
  }
}

// ---------- 貼上圖片（剪貼板） ----------
// 在 textarea 指定位置插入文字，返回新的 cursor 位置
function insertAtCursor(text) {
  const ta = els.noteBody;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const before = ta.value.substring(0, start);
  const after = ta.value.substring(end);
  ta.value = before + text + after;
  // 將游標移到插入內容之後
  const newPos = start + text.length;
  ta.selectionStart = newPos;
  ta.selectionEnd = newPos;
  ta.focus();
  const note = notes.find(n => n.id === currentId);
  if (note) note.content = ta.value;
  if (previewMode) renderPreview(ta.value);
  updateImgStrip();
}

// 判斷複製的 HTML 是否帶格式（有粗體/標題/鏈接/圖片等）
function htmlHasFormatting(html) {
  if (!html) return false;
  // 去掉常見的純文字包裝，睇有冇真實格式
  const test = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<meta[\s\S]*?>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<span[^>]*>/gi, '')
    .replace(/<\/span>/gi, '')
    .replace(/<font[^>]*>/gi, '')
    .replace(/<\/font>/gi, '')
    .replace(/<div[^>]*>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .trim();
  return /<(b|strong|i|em|u|h[1-6]|a|img|ul|ol|li|blockquote|pre|code|table|p)\b/i.test(test);
}

// HTML → Markdown
function htmlToMarkdown(html) {
  if (typeof TurndownService === 'undefined') return html;
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });
  td.addRule('strikethrough', {
    filter: ['del', 's', 'strike'],
    replacement: content => `~~${content}~~`
  });
  return td.turndown(html);
}

// data URL → Blob
function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = (header.match(/data:([^;]+)/) || [])[1] || 'image/png';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// 富文本 + 圖片貼上處理
async function handleRichPaste(e) {
  if (!currentId) return;
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;

  // 收集：圖片文件 + html + 純文字
  const imageFiles = [];
  let html = '';
  let plain = '';
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    } else if (item.kind === 'string') {
      if (item.type === 'text/html' && html === '') {
        html = await new Promise(r => item.getAsString(r));
      }
      if (item.type === 'text/plain' && plain === '') {
        plain = await new Promise(r => item.getAsString(r));
      }
    }
  }

  // 情況 1：有圖片 → 上傳並插入（保留周邊文字格式）
  if (imageFiles.length > 0) {
    e.preventDefault();

    // 若同時有富文本 HTML，將 HTML 內嵌圖片(獨立文件)與 data URL 圖片一併上傳替換，保留格式
    if (html && htmlHasFormatting(html)) {
      showUploading(`處理富文本 + ${imageFiles.length} 張圖片...`);
      let doc;
      try {
        doc = new DOMParser().parseFromString(html, 'text/html');
      } catch (_) { doc = null; }

      // 1) 處理剪貼板獨立的圖片文件
      const fileImgPromises = imageFiles.map(async (file) => {
        const result = await uploadFile(file);
        return result.ok ? result.url : null;
      });
      let fileUrls = await Promise.all(fileImgPromises);
      fileUrls = fileUrls.filter(u => u);

      // 2) 處理 HTML 內嵌的 <img>（data URL 或 遠程 URL）
      let embeddedUrls = [];
      if (doc) {
        const imgs = doc.querySelectorAll('img');
        embeddedUrls = await Promise.all(Array.from(imgs).map(async (img) => {
          const src = img.getAttribute('src') || '';
          // data URL → 轉 file 上傳
          if (src.startsWith('data:')) {
            try {
              const blob = dataUrlToBlob(src);
              const fname = 'pasted_' + Date.now() + '.png';
              const file = new File([blob], fname, { type: blob.type || 'image/png' });
              const result = await uploadFile(file);
              return result.ok ? result.url : null;
            } catch (_) { return null; }
          }
          // 遠程圖片 URL：保留原樣（跨域，唔上傳）
          if (/^https?:\/\//i.test(src)) return src;
          return null;
        }));
        embeddedUrls = embeddedUrls.filter(u => u);
      }

      // 替換 doc 中的 img src（順序對應）
      if (doc) {
        const imgs = doc.querySelectorAll('img');
        let fi = 0, ei = 0;
        imgs.forEach((img) => {
          const src = img.getAttribute('src') || '';
          if (src.startsWith('data:')) {
            if (ei < embeddedUrls.length) img.setAttribute('src', embeddedUrls[ei++]);
          } else if (/^https?:\/\//i.test(src)) {
            // 已保留
          } else {
            // 本地相對路徑（剪貼板獨立圖片，以順序填補）
            if (fi < fileUrls.length) img.setAttribute('src', fileUrls[fi++]);
          }
        });
        html = doc.body.innerHTML;
      }

      hideUploading();
      const md = htmlToMarkdown(html).replace(/\n{3,}/g, '\n\n');
      insertAtCursor(md);
      return;
    }

    // 否則：純圖片上傳（伴隨純文字一併插入）
    showUploading(`上傳中 ${imageFiles.length} 張圖片...`);
    let mdImages = '';
    for (const img of imageFiles) {
      try {
        const result = await uploadFile(img);
        if (result.ok) {
          mdImages += `\n![${img.name}](${result.url})\n`;
        }
      } catch (err) {
        alert(`圖片上傳出錯：${err.message}`);
      }
    }
    hideUploading();
    // 如有伴隨文字，先用文字，再插圖片
    if (plain && plain.trim()) {
      insertAtCursor(plain.trim() + '\n' + mdImages);
    } else {
      insertAtCursor(mdImages);
    }
    return;
  }

  // 情況 2：有富文本格式 → 轉 Markdown 插入
  if (html && htmlHasFormatting(html)) {
    e.preventDefault();
    const md = htmlToMarkdown(html).replace(/\n{3,}/g, '\n\n');
    insertAtCursor(md);
    return;
  }

  // 情況 3：純文字，讓瀏覽器預設處理（唔攔截）
}

// ---------- 事件綁定 ----------
function bindEvents() {
  els.btnNewNote.addEventListener('click', newNote);
  els.btnDelete.addEventListener('click', deleteNote);
  els.btnSave.addEventListener('click', () => saveCurrent());

  els.btnPreview.addEventListener('click', togglePreview);

  // 分享
  els.btnShare.addEventListener('click', openShareModal);
  els.btnShareClose.addEventListener('click', closeShareModal);
  els.btnCopyUrl.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.shareUrl.value);
      els.btnCopyUrl.textContent = '✓ 已複製';
      setTimeout(() => { els.btnCopyUrl.textContent = '複製'; }, 1500);
    } catch (e) {
      els.shareUrl.select();
      document.execCommand('copy');
      els.btnCopyUrl.textContent = '✓ 已複製';
      setTimeout(() => { els.btnCopyUrl.textContent = '複製'; }, 1500);
    }
  });
  els.btnUnshare.addEventListener('click', async () => {
    const id = currentId;
    if (!confirm('確定要取消分享呢篇記事？\n其他人將無法再透過連結檢視。')) return;
    try {
      await unshareNote(id);
      closeShareModal();
      alert('已取消分享');
    } catch (e) {
      alert('取消分享失敗：' + e.message);
    }
  });
  // 撳彈窗遮罩關閉
  els.shareModal.addEventListener('click', (e) => {
    if (e.target === els.shareModal) closeShareModal();
  });

  els.fileImage.addEventListener('change', e => {
    uploadFiles(e.target.files);
    e.target.value = '';
  });
  els.fileDoc.addEventListener('change', e => {
    uploadFiles(e.target.files);
    e.target.value = '';
  });

  // 密碼開關
  els.lockSwitch.addEventListener('change', () => {
    if (els.lockSwitch.checked) {
      els.lockBar.classList.remove('hidden');
    } else {
      // 關閉鎖需要確認（會清空密碼）
      els.lockBar.classList.add('hidden');
    }
  });

  // 自動保存標題（延遲）
  let titleTimer = null;
  els.noteTitle.addEventListener('input', () => {
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => {
      const note = notes.find(n => n.id === currentId);
      if (note) {
        note.title = els.noteTitle.value.trim();
        note.updated = Date.now();
        saveNotes();
        renderList();
      }
    }, 400);
  });

  // 編輯內容時實時更新圖片縮圖（貼上圖片即顯示）
  let bodyTimer = null;
  els.noteBody.addEventListener('input', () => {
    updateImgStrip();
    clearTimeout(bodyTimer);
    bodyTimer = setTimeout(() => {
      const note = notes.find(n => n.id === currentId);
      if (note) {
        note.content = els.noteBody.value;
        note.updated = Date.now();
        saveNotes();
      }
    }, 600);
  });

  // Ctrl+S 保存
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveCurrent();
    }
  });

  // 剪貼板貼圖
  document.addEventListener('paste', handleRichPaste);

  // 解鎖彈窗
  els.btnUnlockOk.addEventListener('click', tryUnlock);
  els.btnUnlockCancel.addEventListener('click', hideUnlockModal);
  els.unlockInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') tryUnlock();
    if (e.key === 'Escape') hideUnlockModal();
  });

  // 移動端抽屜（側欄）
  const mobileFab = $('mobileFab');      // 頂層浮動按鈕（始終可見）
  const mobileMenu = $('mobileMenu');    // 工具列內備用入口
  const mobileClose = $('mobileClose');
  const mobileOverlay = $('mobileOverlay');
  const sidebarEl = document.querySelector('.sidebar');
  function openSidebar() {
    if (window.innerWidth > 768) return;
    sidebarEl.classList.add('open');
    mobileOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('drawer-open');
  }
  function closeSidebar() {
    sidebarEl.classList.remove('open');
    mobileOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    document.body.classList.remove('drawer-open');
  }
  if (mobileFab) mobileFab.addEventListener('click', openSidebar);
  if (mobileMenu) mobileMenu.addEventListener('click', openSidebar);
  if (mobileClose) mobileClose.addEventListener('click', closeSidebar);
  if (mobileOverlay) mobileOverlay.addEventListener('click', closeSidebar);
  // 監聽列表點擊後收起（透過 note-item 點擊）
  els.noteList.addEventListener('click', () => {
    if (window.innerWidth <= 768) closeSidebar();
  });

  // 分割線拖曳
  initDivider();
}

// ---------- 分割線拖曳 ----------
function initDivider() {
  let dragging = false;
  const sidebar = document.querySelector('.sidebar');
  const startX = () => null;

  els.divider.addEventListener('mousedown', e => {
    dragging = true;
    els.divider.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const w = Math.min(Math.max(e.clientX, 180), window.innerWidth - 320);
    sidebar.style.width = w + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      els.divider.classList.remove('dragging');
    }
  });
}

// ---------- 初始化 ----------
async function init() {
  await loadNotes();   // 從伺服器載入（含舊數據遷移）
  bindEvents();
  renderList();
  refreshShareState();  // 非同步載入分享狀態
}

// 啟動
init();
