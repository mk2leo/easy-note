# 📒 網上記事簿（測試版）
<img width="1544" height="769" alt="image" src="https://github.com/user-attachments/assets/8b19a5fd-f0a2-47a6-aedf-23f1ba820e10" />

適配手機版
<img width="1060" height="2376" alt="92f9b85fb5f6e493d2c5d3e545f851f0" src="https://github.com/user-attachments/assets/d77393dc-0a5d-4a67-b094-91a0f3e6ad18" />

左右分頁嘅網上記事簿：左頁標題列表，右頁內容編輯。支援 Markdown、代碼高亮、上傳圖片/文件、密碼保護。

## 功能

- **左右分欄**：左頁標題列表，右頁內容編輯；分割線可拖曳調整寬度
- **代碼高亮**：內容用 Markdown 書寫，``` 代碼塊自動高亮（python/js/java 等常見語言）
- **上傳圖片**：工具列 🖼️，或直接喺編輯區貼上圖片（剪貼板）
- **上傳文件**：工具列 📎，任何類型文件都可上傳，附件列喺內容下方
- **富文本貼上**：喺其他網頁/文檔複製帶格式嘅內容（粗體、標題、鏈接、列表等），直接貼上會自動轉成 Markdown；圖片會自動上傳保留
- **圖片即時顯示**：貼上圖片後，編輯區底部會**即時顯示縮圖**，唔使切去預覽模式就睇到；撳縮圖一鍵切去預覽睇大圖
- **分享 / 取消分享**：每篇筆記工具列 🔗 分享按鈕，一撳開啟分享並生成唯讀連結（`share.html?id=xxx`），分享狀態會喺左頁列表顯示 🔗 圖示；撳「取消分享」即刻收回，連結失效。密碼鎖定嘅筆記分享出去都只會顯示標題，內容唔會公開
- **密碼保護**：右上角 🔒 開關，設定密碼後記事鎖定；喺列表按鎖定記事時要解鎖先睇到內容
- **預覽模式**：👁️ 切換編輯/預覽
- **持久化（資料庫）**：記事存喺伺服器 SQLite 資料庫（`data/notesbook.db`），換機/多人都睇到同一啲記事，刷新唔會丟失
- **快捷鍵**：Ctrl+S 儲存

## 啟動

```bash
node server.js
# 或指定端口
PORT=8686 node server.js
```

> ⚠️ 需要 **Node.js v22+**（使用內置 `node:sqlite`）。
> 如果 Node 版本較舊，會自動降級為 JSON 文件儲存（仍存伺服器硬盤 `data/`），功能不變。

訪問：`http://localhost:8686`

## 目錄結構

```
notesbook/
├── server.js          # Node 靜態伺服器 + API + 資料庫（端口 8686）
├── data/              # 資料庫目錄（自動創建）
│   ├── notesbook.db   # SQLite 資料庫（Node 22+）
│   └── notes.json     # JSON 降級儲存（Node <22 時使用）
└── public/
    ├── index.html     # 前端頁面
    ├── style.css      # 樣式（深色主題）
    ├── app.js         # 前端邏輯
    ├── share.html     # 分享頁
    └── uploads/       # 上傳文件存放目錄（自動創建）
```

## 技術說明

- 前端：原生 HTML/CSS/JS + [marked](https://marked.js.org/) (Markdown) + [highlight.js](https://highlightjs.org/) (代碼高亮)，由 CDN 載入
- 後端：Node.js 內置 `http` 模組 + `node:sqlite`，無第三方依賴，直接 `node server.js` 即可運行
- **資料庫**：SQLite（Node 22+ 內置），記事存 `data/notesbook.db`；舊 Node 自動降級 JSON 檔案
- 記事 API：`POST/GET /api/notes`（新建/列表）、`GET/PUT/DELETE /api/notes/:id`（讀取/更新/刪除）
- 上傳接口：`POST /api/upload`（multipart/form-data，限制 100MB）
- 分享接口：`POST /api/share`（開啟）、`DELETE /api/share/:id`（取消）、`GET /api/share/:id`（讀取）、`GET /api/shared`（列表）
- 分享頁：`public/share.html`，透過 `?id=xxx` 唯讀展示分享內容
- 密碼：前端以 SHA-256 哈希後儲存，唔會明文保存
- 舊數據遷移：首次運行會自動把瀏覽器 localStorage 舊記事搬入資料庫

## 已知限制（測試版）

- 記事數據存伺服器資料庫，但**無用戶系統**，所有訪問者共用同一批記事（適合單人/小團隊）
- 分享內容係**快照**：分享時保存當時內容，之後再編輯唔會自動更新分享（需要重新撳分享）
- 分享無訪問權限控制/密碼驗證，連結有份就可以睇（除非筆記本身鎖定）
- 上傳嘅文件存喺伺服器硬盤，未有配額同清理機制
- 密碼哈希喺前端計算，唔適用於高安全性場景

## 部署到伺服器

如需部署到你嘅伺服器（寶塔 / 騰訊雲輕量），見 `DEPLOY-BAOTAO.md`（寶塔版）或 `DEPLOY.md`（SSH 版）。
