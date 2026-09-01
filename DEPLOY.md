# 🚀 網上記事簿 — 伺服器部署教學

呢份教學教你將「網上記事簿」部署到你嘅 Linux 伺服器（騰訊雲輕量 / Rocky Linux / Ubuntu / Debian / CentOS 都適用）。

## 一、準備事項

- 一部 Linux 伺服器（有公網 IP）
- 伺服器已裝 **Node.js 16+**（項目用內置 `http`，無第三方依賴）
- 防火牆開放 **8686 端口**（或你改用嘅端口）
- 一個域名（可選，如果想用域名 + HTTPS 訪問）

---

## 二、上傳項目到伺服器

有以下幾種方法（揀一種）：

### 方法 1：用 scp（本機有 ssh 工具）

喺你本機（Windows 開 Git Bash / PowerShell）執行：

```bash
# 將 notesbook 整個資料夾上傳到伺服器 /root 目錄
scp -r /你的本機路徑/notesbook root@你的伺服器IP:/root/

# 例如
scp -r notesbook root@193.112.217.169:/root/
```

### 方法 2：用 rsync（更快，只傳有改動嘅文件）

```bash
rsync -avz notesbook/ root@你的伺服器IP:/root/notesbook/
```

### 方法 3：用 SFTP（如 WinSCP / FileZilla / 騰訊雲 web 終端）

用 SFTP 連上伺服器，將 `notesbook` 整個資料夾拖上去 `/root/`。

### 方法 4：打包後上傳再解壓

```bash
# 本機打包（見「打包」一節）
tar -czvf notesbook.tar.gz notesbook

# 上傳
scp notesbook.tar.gz root@你的伺服器IP:/root/

# 喺伺服器解壓
cd /root && tar -xzvf notesbook.tar.gz
```

---

## 三、安裝 Node.js（如果未裝）

### Rocky Linux / CentOS
```bash
# 安裝 NodeSource 倉庫（Node 18）
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs
node -v   # 應該顯示 v18.x
```

### Ubuntu / Debian
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs
node -v
```

---

## 四、啟動服務

### 簡單測試啟動

```bash
cd /root/notesbook
node server.js
```

見到以下輸出即成功：
```
📒 網上記事簿已啟動
   ➜ 本地訪問: http://localhost:8686
```

### 測試訪問

喺伺服器本機測試：
```bash
curl http://localhost:8686
```
應該返回 HTML 內容。

然後喺你瀏覽器開：`http://你的伺服器IP:8686`

> ⚠️ 如果開唔到，可能係防火牆未開放端口，見下文「五、防火牆」。

---

## 五、開放防火牆端口（重要！）

### 騰訊雲輕量伺服器

1. 登入騰訊雲控制台 → 輕量應用伺服器 → 揀你嘅伺服器 → **防火牆**
2. 撳「**添加規則**」
3. 應用類型揀「**自定義**」，端口填 `8686`，協議 TCP，來源 `0.0.0.0/0`
4. 確定

### 伺服器系統防火牆（firewalld，Rocky/CentOS）

```bash
# 開放 8686 端口
firewall-cmd --permanent --add-port=8686/tcp
firewall-cmd --reload

# 檢查
firewall-cmd --list-ports
```

### 如果係 ufw（Ubuntu）
```bash
ufw allow 8686/tcp
ufw reload
```

---

## 六、讓服務常駐運行（唔會一關終端就停）

Ctrl+C 或用 ssh 登出會令服務停止。要長駐要用 **systemd** 或 **pm2**。

### 方法 A：systemd（推薦，開機自動啟動）

建立服務檔案：
```bash
sudo nano /etc/systemd/system/notesbook.service
```

貼入以下內容（**改返你實際路徑**）：
```ini
[Unit]
Description=NotesBook Web App
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/notesbook
ExecStart=/usr/bin/node /root/notesbook/server.js
Restart=always
RestartSec=3
# 環境變量（可選，唔填默認 8686）
Environment=PORT=8686

[Install]
WantedBy=multi-user.target
```

> 檢查 node 路徑：`which node`，如果唔係 `/usr/bin/node` 就改返。

啟用並啟動：
```bash
sudo systemctl daemon-reload
sudo systemctl enable notesbook     # 開機自動啟動
sudo systemctl start notesbook      # 啟動

# 查看狀態
sudo systemctl status notesbook

# 睇日誌
sudo journalctl -u notesbook -f
```

常用管理命令：
```bash
sudo systemctl restart notesbook    # 重啟
sudo systemctl stop notesbook       # 停止
sudo systemctl start notesbook      # 啟動
```

### 方法 B：用 pm2（需要 npm 安裝）

```bash
# 全局安裝 pm2
npm install -g pm2

# 啟動
cd /root/notesbook
pm2 start server.js --name notesbook

# 保存，確保開機自動啟動
pm2 save
pm2 startup
```

pm2 常用命令：
```bash
pm2 list                # 睇進程
pm2 logs notesbook      # 睇日誌
pm2 restart notesbook   # 重啟
pm2 stop notesbook      # 停止
```

---

## 七、（可選）用域名 + HTTPS 訪問

如果唔想記 IP 加端口，可以綁域名並開 HTTPS。需要 Nginx。

### 安裝 Nginx
```bash
# Rocky/CentOS
yum install -y nginx

# Ubuntu/Debian
apt-get install -y nginx
```

### 配置反向代理

建立配置：
```bash
sudo nano /etc/nginx/conf.d/notesbook.conf
```

貼入（**將 example.com 換成你域名**）：
```nginx
server {
    listen 80;
    server_name example.com;

    # 最大上傳限制（圖片/文件上傳）
    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:8686;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }
}
```

測試並重載 Nginx：
```bash
nginx -t
systemctl enable nginx
systemctl restart nginx
```

### 申請免費 HTTPS 證書（Let's Encrypt）

用 certbot：
```bash
# 安裝 certbot
yum install -y certbot python3-certbot-nginx
# 或
apt-get install -y certbot python3-certbot-nginx

# 申請並自動配置
certbot --nginx -d example.com
```

之後就可以用 `https://example.com` 訪問喇！

---

## 八、數據儲存位置（重要）

- **記事內容**：存喺每個訪問者嘅瀏覽器 localStorage（唔喺伺服器）
- **分享數據**：`/root/notesbook/share_data/shared.json`
- **上傳圖片/文件**：`/root/notesbook/public/uploads/`

> ⚠️ 因為記事存瀏覽器，所以**每個人用唔同瀏覽器 / 清除數據都會唔見自己啲記事**。呢個係測試版嘅限制。如果你想升級成「記事存伺服器資料庫」，我可以幫你改造。

---

## 九、更新項目

```bash
# 上傳新版本
scp -r 新版本/notesbook/* root@你的伺服器IP:/root/notesbook/

# 重啟服務
sudo systemctl restart notesbook
# 或
pm2 restart notesbook
```

> ⚠️ 更新時唔好覆蓋 `share_data/` 同 `public/uploads/` 入面已有嘅數據。

---

## 十、常見問題

**Q: 訪問唔到？**
1. 確認防火牆開放咗 8686 端口（騰訊雲控制台 + 系統防火牆）
2. 確認服務喺運行：`systemctl status notesbook` 或 `pm2 list`
3. 本機測試：`curl http://localhost:8686`

**Q: 上傳文件失敗？**
- 檢查 Nginx `client_max_body_size` 是否足夠（預設 1M 太細）
- 檢查 `public/uploads/` 目錄權限：`chmod -R 755 /root/notesbook/public/uploads`

**Q: 圖片顯示唔到？**
- 確認圖片有成功上傳（睇 `public/uploads/` 有冇文件）
- 瀏覽器強制刷新 `Ctrl+Shift+R`

---

祝你架設順利！有問題可以問我。😊
