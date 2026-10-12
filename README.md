# 🤖 智聊小精靈 (Gemini Smart Bot) — LINE Bot 改善版

一個基於 **Flask** + **LINE Messaging API v3** + **Google Gemini AI** 的繁體中文生活對話智慧助理。  
本專案為「課後作業 LINE Bot 改善版」，以第一版為起點完成**輸入防呆引導、不支援訊息格式智能提示與內建離線功能指南**等關鍵改善。

---

## 📌 專題基本資訊與繳交連結

- **專題名稱：** 智聊小精靈 (Gemini Smart Bot)
- **GitHub 專案庫：** [https://github.com/41154B003Sam/line-bot](https://github.com/41154B003Sam/line-bot)
- **開發紀錄網頁 (GitHub Pages)：** [https://41154b003sam.github.io/line-bot/](https://41154b003sam.github.io/line-bot/)
- **成果簡報檔案：** [`LINEBot-智聊小精靈-成果簡報.pdf`](LINEBot-智聊小精靈-成果簡報.pdf)（5 頁專題簡報）
- **實測證明段落：** [開發紀錄網頁第六章「測試結果與實測證明」](https://41154b003sam.github.io/line-bot/#test-proof)

---

## 👥 用途與使用對象

- **用途：** 提供隨身常駐於 LINE 聊天室的 24/7 生活智慧對話助理。使用者無需下載額外 App 或前往專門網頁登入，在日常通訊軟體中即可發問生活知識、旅遊推薦、草稿撰寫與靈感解答。
- **使用對象：** 所有 LINE 日常高頻度使用者（上班族、學生、家庭日常），特別適合需要在手機上以簡潔中文快速獲得答案、不耐繁複操作的人群。

---

## ✨ 核心功能與改善版新特性

| 功能分類 | 功能項目 | 說明 |
|----------|----------|------|
| **🚀 v1.2.0 重磅** | 🧠 本地 Qwen 2.5 3B (Ollama) | 本機 RTX 3050 GPU 驅動，零 API 費用、無額度限制，首選本地大腦 |
| **🚀 v1.2.0 重磅** | 🌐 即時聯網搜尋 (ddgs) | 免費爬取 2026 最新即時天氣、新聞與知識，突破模型 2025 知識截止時間 |
| **高可用性** | 🔄 雙大腦無縫備援 | 本地離線時自動切換至 Google Gemini 四重雲端模型佇列，確保 24/7 不斷線 |
| **手機 UX 優化** | 📏 輸出長度與安全截斷 | 控制在 200~450 字（上限 500 字），並於標點符號（`。`、`！`、`？`）安全收尾，不留半句 |
| **版面清洗** | 🎨 移除 Markdown 星號 | 自動清洗 LINE 不支援的 `**` 粗體星號，改採親切 Emoji 與換行條列呈現 |
| **輸入防呆** | 🛡️ 空白與不完整輸入引導 | 攔截純空白訊息提醒補充；對「推薦」、「幫我」等短詞提供分類選單引導 |
| **格式保護** | 💡 全格式不支援訊息提示 | 收到語音、位置、影片、檔案、圖片時主動回傳親切提示並引導文字輸入 |
| **隨身手冊** | 📖 內建離線功能指南 | 輸入「說明」、「功能」或「/help」直接回傳使用教學與 3 大推薦句型 |
| **社交習慣優化** | 😶 貼圖/純表情已讀不回 | 收到貼圖或純 Emoji 僅記錄後台 Log，不回覆訊息，節省運算資源 |

---

## 🔄 改善版四大紀錄（前後差異對比）

1. **原本問題：**
   - 輸入空白或模糊單詞（如「推薦」）直接調用 Gemini，耗損 Token 且回答偏離預期。
   - 傳送語音、位置、影片、檔案等非文字訊息時機器人毫無反應，使用者誤以為故障。
   - 缺乏離線功能教學指令，初次使用者不知能問什麼。
2. **修改內容：**
   - 增加空白字串檢驗與不完整輸入分類選單（`incomplete_dict`）。
   - 註冊 `AudioMessageContent`、`LocationMessageContent`、`VideoMessageContent`、`FileMessageContent`、`ImageMessageContent` 專屬事件處理器。
   - 實作「說明 / 功能 / /help」離線指南指令。
3. **前後差異：**
   - *改善前 (v1.0.0)*：遇到非文字格式無反饋；模糊輸入易浪費 AI 配額；無內建幫助。
   - *改善後 (v1.0.1)*：訊息格式 100% 覆蓋反饋；模糊輸入主動導流；提供隨身功能選單。
4. **重新測試結果：**
   - 空白輸入與「推薦」均能觸發補充指引；語音與位置皆獲得友善提示；正常問答流暢穩定，三大測試全數通過！

---

## 📁 專案結構與文件交付 (Deliverables)

```
line-bot/
├── app.py                             # 後端核心主程式（Flask + LINE SDK v3 + Gemini AI 改善版）
├── requirements.txt                   # Python 套件依賴清單
├── .env.example                       # 環境變數範例設定檔（不含真實金鑰）
├── .gitignore                         # 機密隔離規則（嚴格排除 .env 等機密）
├── index.html                         # 🌐 開發紀錄網頁原始檔（GitHub Pages 託管）
├── LINEBot-智聊小精靈-成果簡報.pdf   # 📊 專案成果簡報（5 頁完整 PDF）
├── LINEBot-智聊小精靈-成果簡報.html  # 成果簡報投影片原始檔（16:9）
├── LINE_Bot_v1_Project_Plan.pdf      # 📄 原版專案計畫書正式文件 (A4 PDF)
├── LINE_Bot_v1_Project_Plan.html     # 原版專案計畫書網頁原始檔 (A4)
├── LINE_Bot_v1_Presentation.pdf      # 原版審查簡報 (16:9 PDF)
├── LINE_Bot_v1_Presentation.html     # 原版審查簡報網頁原始檔 (16:9)
└── LINE_Bot_v1_Executive_Summary.md   # 執行摘要說明文件
```

---

## 🚀 快速開始與設定方式

### 1. 複製專案

```bash
git clone https://github.com/41154B003Sam/line-bot.git
cd line-bot
```

### 2. 安裝依賴套件

```bash
pip install -r requirements.txt
```

### 3. 設定環境變數（機密隔離）

複製範本檔案建立 `.env`：

```bash
cp .env.example .env
```

編輯 `.env`，填入您的金鑰（**注意：請勿將真實金鑰上傳至 GitHub！**）：

```env
# LINE Developers Messaging API Credentials
LINE_CHANNEL_SECRET=your_channel_secret_here
LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token_here

# Google Gemini API Key (可自 Google AI Studio 免費取得)
GEMINI_API_KEY=your_gemini_api_key_here

# 本地伺服器通訊埠
PORT=5000
```

> 💡 **取得金鑰指引：**
> - LINE：前往 [LINE Developers Console](https://developers.line.biz/) 建立 Messaging API Channel。
> - Gemini：前往 [Google AI Studio](https://aistudio.google.com/app/apikey) 免費取得 API Key。

### 4. 啟動伺服器

```bash
python app.py
```

伺服器將在 `http://localhost:5000` 啟動，可透過 `GET /health` 驗證金鑰載入狀態。

### 5. 啟動公開 HTTPS 穿透（Cloudflare Tunnel 免費方案）

```bash
# Windows 透過 winget 安裝
winget install cloudflare.cloudflared

# 啟動臨時通道
cloudflared tunnel --url http://localhost:5000
```

複製終端機產生的 `https://xxxx.trycloudflare.com` 網址。

### 6. 設定 LINE Webhook

前往 LINE Developers Console → 您的 Channel → **Messaging API**：
1. **Webhook URL** 填入：`https://你的穿透網址/callback`
2. 開啟 **Use webhook**
3. 關閉 **Auto-reply messages**
4. 點擊 **Verify**，確認回傳 `Success`。

---

## 🧪 使用方法與三大測試情境

| 情境 | 測試操作輸入 | 預期結果 | 實際測試結果 |
|------|-------------|----------|--------------|
| **1. 正常使用** | 發送「請推薦台北 3 個適合閱讀的安靜咖啡廳」 | 產出 250~450 字繁中推薦，排版條列清晰，無 `**` 星號，句尾完整收尾。 | 回傳「嗨！我是你的智聊小精靈...為你精選 3 間台北極度適合沉浸閱讀的口袋名單...」完整收尾於句點。 |
| **2. 輸入不完整** | 發送空白訊息「   」或單詞「推薦」 | 即時提醒輸入為空白或補充詳細需求，提供分類選單引導。 | 空白輸入回覆提醒填寫內容；「推薦」回覆提供美食/旅遊/娛樂 3 大分類引導補充。 |
| **3. 不支援的輸入** | 發送位置資訊 (Location) 或語音訊息 (Audio) | 提供明確親切提示，告知不支援該格式並引導改用文字輸入。 | 位置訊息即時回覆暫不支援定位，請直接打字；語音訊息回覆請改文字輸入。 |

---

## ⚠️ 已知限制與下一步藍圖

1. **無多輪對話記憶 (Stateless)：** 目前問答為單輪獨立運作，機器人無法記憶上一個問題；下階段預計導入 Redis 或 SQLite 儲存最近 3~5 輪 Session 上下文。
2. **本地主機依賴：** 目前依賴本機開機與臨時 Cloudflare 隧道；下階段將容器化（Docker）部署至 Google Cloud Run 達成 24 小時不間斷服務。
3. **尚未支援圖文選單 (Rich Menu)：** 下階段將在 LINE 後台建立六宮格視覺化快捷選單。
4. **尚未支援多模態圖片分析：** 目前收到圖片會提示暫不支援，未來將串接 Gemini 視覺辨識模型分析影像內容。

---

## 📝 License

本專案採 MIT License 開源發布，供學習與專題研究使用。
