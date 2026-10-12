# 🤖 智慧 LINE AI 對話助理 (Smart LINE Bot)

這是一個基於 **Flask** + **LINE Messaging API v3** + **本地 GPU 模型 (Qwen 2.5 3B)** + **即時聯網搜尋 (Search Grounding)**，並具備 **Google Gemini 雲端四重備援** 的繁體中文智慧助理機器人。

本專案解決了傳統大型語言模型「知識庫停留在 2024~2025 年」的限制，透過即時網路檢索技術，讓機器人能即時查詢 2026 年最新動態、天氣與新聞，並由本地 GPU 進行高速推理，達成零 API 費用、無額度限制的智慧對話。

---

## 🔒 資安與金鑰管理聲明 (Security Statement)

本專案嚴格遵循資安規範：
- 程式庫內**絕不包含**任何 LINE 長效存取權杖 (Channel Access Token)、頻道密鑰 (Channel Secret)、試算表 ID (Spreadsheet ID)、Google Apps Script `/exec` 網址或任何真實金鑰。
- 所有敏感設定均透過本地環境變數（`.env`）於啟動時讀取，並已透過 `.gitignore` 嚴格隔離，防止機密上傳至公開儲存庫。
- 本專案提供 `.env.example` 範本檔案，僅使用佔位文字說明，使用者啟動時自備設定即可。

---

## 🛠️ 如何安裝 (How to Install)

### 1. 複製本專案庫

```bash
git clone https://github.com/41154B003Sam/smart-line-bot.git
cd smart-line-bot
```

### 2. 安裝 Python 依賴環境

確保電腦已安裝 Python 3.10 以上版本，執行以下指令安裝所需套件：

```bash
pip install -r requirements.txt
```

*（套件包含：`flask`、`line-bot-sdk`、`python-dotenv`、`google-genai`、`ddgs`、`requests`）*

### 3. （可選但推薦）安裝本地 AI 引擎 Ollama

若希望使用本機 GPU 運行 Qwen 2.5 3B 模型（免 API 費用、無上限）：
1. 至 Ollama 官網下載安裝：[https://ollama.com/download](https://ollama.com/download)
2. 開啟終端機下載模型：
   ```bash
   ollama pull qwen2.5:3b
   ```
3. 確保 Ollama 服務於背景運行（預設監聽 `http://localhost:11434`）。
*(若未安裝 Ollama，系統會自動無縫切換至 Google Gemini 雲端模型)*

### 4. 設定環境變數

複製範本檔案 `.env.example` 並更名為 `.env`：

```bash
cp .env.example .env
```

編輯 `.env`，填入您的 LINE 與 Gemini 設定（使用佔位說明，請填入您自己的金鑰）：

```env
# LINE Developers Messaging API Credentials
LINE_CHANNEL_SECRET=your_channel_secret_here
LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token_here

# Google Gemini API Key (可於 Google AI Studio 免費申請作為備援)
GEMINI_API_KEY=your_gemini_api_key_here

# 本地 Ollama 伺服器設定 (預設即可)
OLLAMA_API_URL=http://localhost:11434
LOCAL_MODEL_NAME=qwen2.5:3b

# 伺服器通訊埠
PORT=5000
```

---

## ▶️ 如何執行 (How to Run)

### 步驟 1：啟動後端伺服器

在專案目錄下執行：

```bash
python app.py
```

伺服器將在 `http://localhost:5000` 啟動。您可以開啟瀏覽器存取 `http://localhost:5000/health` 查看健康檢查狀態。

### 步驟 2：開啟公開 HTTPS 穿透（Cloudflare Tunnel）

LINE Webhook 需要合法的公開 HTTPS 網址。使用免費的 Cloudflare Tunnel：

```bash
# Windows (若未安裝可用 winget install cloudflare.cloudflared)
cloudflared tunnel --url http://localhost:5000
```

終端機將產生一組臨時網址（例如：`https://xxxx.trycloudflare.com`）。

### 步驟 3：設定 LINE Developers 後台

1. 登入 [LINE Developers Console](https://developers.line.biz/console/)。
2. 進入您的 Messaging API Channel ➜ 切換至 **Messaging API** 分頁。
3. 將 **Webhook URL** 設定為：`https://你的穿透網址/callback`
4. 開啟 **Use webhook** 開關。
5. 點擊 **Verify** 按鈕確認回傳 `Success` 即可開始在 LINE 聊天室中互動！

> ⚠️ **重要提醒（還原 Webhook）：**  
> 測試完畢後，請按下 `Ctrl + C` 關閉伺服器。若您原本有正在運行的待辦事項機器人（例如 Windows 5 Apps Script 或 `/exec` 網址），**請務必在 LINE Developers 後台將 Webhook URL 切換回您原本的 Apps Script 網址**，否則您原本的待辦事項機器人將無法接收訊息。

---

## 🔄 修改了什麼 (What You Modified)

本專案歷經多次實務迭代與健全度升級，核心修改內容如下：

### 1. 雙大腦架構：本地 GPU 模型 + 即時聯網搜尋 (v1.2.0)
- **原本問題**：傳統大型語言模型的記憶停留在 2024~2025 年，無法回答當前時間（2026年）的新聞、即時氣象或最新動態；且純依賴雲端 API 容易耗盡每週免費額度。
- **具體修改**：
  - 導入本地 **Qwen 2.5 3B**（由本機 RTX 3050 顯卡運行），零 API 成本、無調用次數限制。
  - 整合 `ddgs` 免費搜尋引擎：當使用者提問即時資訊（天氣、新聞、最新話題、推薦等），系統自動上網爬取前 2~3 則即時網路摘要，注入 Prompt 供模型參考。
  - 設計**雙大腦無縫備援機制**：若本地 Ollama 未啟動，自動回退至 Google Gemini 四重雲端模型佇列，確保 24/7 不斷線。

### 2. 輸入防呆與不完整引導機制 (v1.0.1)
- **原本問題**：使用者傳送空白訊息、空格或僅輸入「推薦」、「幫我」等模糊短詞，直接送進 AI 會浪費運算配額且回答偏離預期。
- **具體修改**：
  - 實作空白輸入過濾，主動提醒使用者補充問題。
  - 針對模糊關鍵字提供美食、旅遊、娛樂等 3 大分類選單引導，精準收斂使用者意圖。

### 3. 全格式不支援訊息友善提示
- **原本問題**：初版僅註冊文字與貼圖處理器；若傳送語音、位置、影片、檔案等，機器人毫無反應，使用者無法判定是否故障。
- **具體修改**：
  - 完整註冊 `AudioMessageContent`、`LocationMessageContent`、`VideoMessageContent`、`FileMessageContent`、`ImageMessageContent`。
  - 當收到非文字內容時，主動發送友善提示告知目前功能限制，並引導打字輸入。

### 4. 社交習慣與排版最佳化
- **貼圖／純 Emoji 已讀不回**：收到貼圖或純表情符號時僅記錄後台 Log，不回覆訊息，避免機器人洗版並節省運算資源。
- **500 字長度控制與標點符號安全截斷**：嚴格限制輸出長度於 200~450 字之間，並在最接近末尾的標點（`。`、`！`、`？`）自然收尾，絕不留下半句殘言。
- **Markdown 粗體星號清洗**：自動過濾 LINE 聊天室不支援的 `**` 星號，改採自然換行與 Emoji 排版。

### 5. 跨平台編碼穩定性修復
- **原本問題**：在 Windows 繁體中文環境下，終端機標準輸出預設為 `cp950 / Big5` 編碼。當 AI 回覆包含特殊 Emoji 時會觸發 `UnicodeEncodeError` 導致伺服器崩潰。
- **具體修改**：在伺服器入口加入 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`，確保終端機列印任何特殊符號皆不中斷伺服器。

---

## 📁 檔案結構說明

```
smart-line-bot/
├── app.py              # 核心主程式（雙大腦調度、即時聯網、LINE Webhook）
├── requirements.txt    # Python 套件依賴清單
├── .env.example        # 環境變數範例（安全隔離，不含真實金鑰）
├── .gitignore          # Git 忽略設定（排除 .env 等機密資訊）
└── README.md           # 完整安裝、執行與修改歷程說明手冊
```

---

## 📝 授權說明

本專案採 MIT License 開源發布，僅供學習、教學與專題研究使用。
