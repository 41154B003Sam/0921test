/**
 * =========================================================================
 * 🤖 智聊小精靈 (Smart LINE Bot) - Google Apps Script 24小時雲端全自動回覆版
 * =========================================================================
 * 特色：
 * 1. 24/7 雲端無間斷運行：部署於 Google Cloud，電腦關機也能即時自動回覆
 * 2. 整合 Google Gemini 最新 Flash 模型 (速度飛快、免費額度充裕)
 * 3. 台灣即時時區 (Asia/Taipei) 真實時鐘錨定：精準識別 2026 年與今日日期
 * 4. 直球時鐘秒回機制：詢問「今天幾號」、「現在幾點」零延遲精準回覆
 * 5. 健全輸入防呆：空白訊息提醒、模糊詞（推薦/幫我/查詢）引導選單
 * 6. 貼圖與純 Emoji 已讀不回，圖片/語音/影片/檔案友善格式提示
 * 7. LINE 官方 HMAC-SHA256 數位簽章安全驗證防偽
 * 8. 金鑰全面採用 GAS「指令碼屬性 (Script Properties)」保護，絕不外流
 * =========================================================================
 */

// ==========================================
// 1. 環境設定與金鑰讀取 (從指令碼屬性獲取)
// ==========================================
const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();

// 請於 GAS 後台「專案設定」->「指令碼屬性」中新增這三項：
// 1. CHANNEL_ACCESS_TOKEN: 您的 LINE Messaging API Channel access token
// 2. CHANNEL_SECRET: 您的 LINE Messaging API Channel secret
// 3. GEMINI_API_KEY: 您的 Google Gemini API Key
const CHANNEL_ACCESS_TOKEN = SCRIPT_PROPERTIES.getProperty('CHANNEL_ACCESS_TOKEN') || '';
const CHANNEL_SECRET = SCRIPT_PROPERTIES.getProperty('CHANNEL_SECRET') || '';
const GEMINI_API_KEY = SCRIPT_PROPERTIES.getProperty('GEMINI_API_KEY') || '';

// 預設呼叫的 Gemini 模型名稱
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

// ==========================================
// 2. Webhook 進入點 (doPost & doGet)
// ==========================================

/**
 * 處理 LINE Webhook POST 請求
 */
function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return ContentService.createTextOutput("No post data received.").setMimeType(ContentService.MimeType.TEXT);
  }

  const postDataStr = e.postData.contents;

  // 驗證 LINE 數位簽章 (若有設定 CHANNEL_SECRET 則進行檢查)
  if (CHANNEL_SECRET) {
    const signature = e.parameter['signature'] || (e.headers && (e.headers['X-Line-Signature'] || e.headers['x-line-signature']));
    if (signature && !verifyLineSignature(postDataStr, signature, CHANNEL_SECRET)) {
      console.warn("⚠️ 收到無效的 LINE 簽章，已拒絕。");
      return ContentService.createTextOutput("Invalid signature").setMimeType(ContentService.MimeType.TEXT);
    }
  }

  let events = [];
  try {
    const json = JSON.parse(postDataStr);
    events = json.events || [];
  } catch (err) {
    console.error("JSON 解析失敗: " + err);
    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // 逐一處理 Webhook 事件
  events.forEach(function(event) {
    try {
      handleLineEvent(event);
    } catch (err) {
      console.error("處理事件失敗: " + err);
    }
  });

  // LINE 規定必須回傳 HTTP 200 OK
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

/**
 * 處理 GET 請求 (提供瀏覽器健康檢查測試)
 */
function doGet(e) {
  const timeInfo = getCurrentTimeInfo();
  const statusHtml = `
    <html>
      <head><meta charset="utf-8"><title>智聊小精靈 - 運行狀態</title></head>
      <body style="font-family: sans-serif; padding: 20px; line-height: 1.6;">
        <h2>🤖 智聊小精靈 (LINE Bot GAS 24小時雲端版) 正常運行中！</h2>
        <p>✅ <strong>伺服器時區：</strong> ${timeInfo.fullStr}</p>
        <p>✅ <strong>LINE Token 設定：</strong> ${CHANNEL_ACCESS_TOKEN ? '已設定' : '❌ 未設定'}</p>
        <p>✅ <strong>Gemini Key 設定：</strong> ${GEMINI_API_KEY ? '已設定' : '❌ 未設定'}</p>
        <hr>
        <p>請將此網頁的 URL 貼至 LINE Developers Console 上的 Webhook URL。</p>
      </body>
    </html>
  `;
  return ContentService.createTextOutput(statusHtml).setMimeType(ContentService.MimeType.HTML);
}

// ==========================================
// 3. 事件派發與意圖處理邏輯
// ==========================================

function handleLineEvent(event) {
  // 只處理訊息事件 (message)
  if (event.type !== 'message') {
    return;
  }

  // 防重複處理 (LINE 重試機制去重)
  const eventId = event.webhookEventId || event.replyToken;
  if (eventId) {
    const cache = CacheService.getScriptCache();
    if (cache.get(eventId)) {
      console.log("重複的事件已略過: " + eventId);
      return;
    }
    cache.put(eventId, "1", 60);
  }

  const replyToken = event.replyToken;
  const messageType = event.message.type;
  const userId = event.source && event.source.userId;

  // 1. 文字訊息處理
  if (messageType === 'text') {
    // 立即向使用者手機發送「正在輸入中動畫（3個跳動點）」
    if (userId) {
      sendLoadingAnimation(userId);
    }
    handleTextMessage(event.message.text, replyToken);
    return;
  }

  // 2. 貼圖訊息 (已讀不回，節省額度不洗版)
  if (messageType === 'sticker') {
    console.log("收到使用者貼圖 (package: " + event.message.packageId + ", sticker: " + event.message.stickerId + ")，已讀不回。");
    return;
  }

  // 3. 不支援格式提示：圖片訊息
  if (messageType === 'image') {
    const hint = "【智聊小精靈使用提示】📷\n收到您的圖片囉！目前雲端版本專注於文字智慧問答與生活諮詢，尚未支援圖片視覺辨識。\n\n請直接以文字輸入您的問題與我互動～💡\n（輸入「說明」可查看完整功能清單）";
    sendLineReply(replyToken, hint);
    return;
  }

  // 4. 不支援格式提示：語音訊息
  if (messageType === 'audio') {
    const hint = "【智聊小精靈使用提示】🎙️\n收到您的語音訊息！目前小精靈僅支援文字訊息交流，暫不支援語音辨識喔。\n\n請改用文字輸入告訴我您的問題，我會立刻為您解答！";
    sendLineReply(replyToken, hint);
    return;
  }

  // 5. 不支援格式提示：影片訊息
  if (messageType === 'video') {
    const hint = "【智聊小精靈使用提示】🎥\n收到您的影片！目前小精靈暫不支援影片解析功能，請直接輸入文字與我對話～";
    sendLineReply(replyToken, hint);
    return;
  }

  // 6. 不支援格式提示：位置訊息
  if (messageType === 'location') {
    const hint = "【智聊小精靈使用提示】📍\n收到位置資訊！目前小精靈暫不支援地圖定位解析，請直接打字告訴我您想查詢的地點或附近景點（例如：「推薦台北信義區美食」）！";
    sendLineReply(replyToken, hint);
    return;
  }

  // 7. 不支援格式提示：檔案訊息
  if (messageType === 'file') {
    const hint = "【智聊小精靈使用提示】📁\n收到檔案！目前小精靈暫不支援文件讀取，請直接複製檔案內的文字內容發送給我，我立刻幫您整理或分析！";
    sendLineReply(replyToken, hint);
    return;
  }
}

/**
 * 文字訊息處理核心
 */
function handleTextMessage(rawText, replyToken) {
  const userText = (rawText || "").trim();

  // 情境 A：空白訊息防呆
  if (!userText) {
    const reply = "【智聊小精靈提示】\n您輸入的訊息好像是空白的喔！請輸入您想詢問的內容，例如：\n• 「台北今天天氣如何？」\n• 「請推薦 3 個台北安靜咖啡廳」\n💡 輸入「說明」可查看完整使用指南！";
    sendLineReply(replyToken, reply);
    return;
  }

  // 情境 B：純 Emoji 表情符號（已讀不回覆）
  if (userText === "(emoji)" || isPureEmoji(userText)) {
    console.log("收到使用者傳送純 Emoji，已讀不回。");
    return;
  }

  // 情境 C：說明 / Help 離線功能指引
  const lower = userText.toLowerCase();
  if (["說明", "功能", "指令", "help", "/help", "指南"].indexOf(lower) !== -1) {
    const guide = (
      "🤖【智聊小精靈 24小時雲端智慧版】\n\n" +
      "我已常駐於 Google Cloud，為您提供 24 小時不間斷的智慧生活服務！\n\n" +
      "✨【特色亮點】\n" +
      "1. 24/7 在線：電腦關機也隨時為您解答！\n" +
      "2. 台灣時鐘錨定：精準掌握 2026 年最新時空資訊！\n" +
      "3. 智慧 Google Gemini 大腦：生活問答、文字整理、各類推薦！\n\n" +
      "💡【您可以試著問我】\n" +
      "• 「今天幾號？」或「現在幾點？」\n" +
      "• 「推薦適合閱讀的安靜咖啡廳」\n" +
      "• 「幫我寫一封求職面試感謝信」"
    );
    sendLineReply(replyToken, guide);
    return;
  }

  // 情境 D：模糊關鍵字引導選單
  const incompleteDict = {
    "推薦": (
      "哈囉！收到您的「推薦」需求～請問您想要哪一種類型的推薦呢？😄\n\n" +
      "1. 🍽️ 美食餐廳（請提供地點、預算或料理類型）\n" +
      "2. 🏖️ 旅遊景點（請提供天數、縣市或旅行偏好）\n" +
      "3. 🎬 電影書籍（請提供喜愛的題材類型）\n\n" +
      "請補充詳細一點的線索，小精靈就能為您量身打造精準推薦喔！✨"
    ),
    "幫我": (
      "沒問題！小精靈隨時為您服務 🙋‍♂️\n\n" +
      "請告訴我具體需要幫忙的事情，例如：\n" +
      "• 「幫我寫一封求職感謝信」\n" +
      "• 「幫我翻譯這段英文」\n" +
      "• 「幫我規劃 3 天 2 夜行程」\n\n" +
      "請直接把您的詳細需求告訴我即可！💡"
    ),
    "查詢": "請問您想查詢什麼資訊呢？請告訴我關鍵字，例如「查詢台北捷運路線」或「查詢機器學習定義」！💡"
  };

  if (incompleteDict[userText]) {
    sendLineReply(replyToken, incompleteDict[userText]);
    return;
  }

  // 短字問候快速引導
  if (["你好", "您好", "嗨", "hi", "hello", "在嗎", "安安", "午安", "早安", "晚安"].indexOf(lower) !== -1) {
    const greeting = (
      "嗨！我是「智聊小精靈」✨\n" +
      "我現在運行於 Google Cloud 雲端，24 小時隨時待命！\n" +
      "今天有什麼想聊聊或查詢的嗎？輸入「說明」可看完整功能清單喔！"
    );
    sendLineReply(replyToken, greeting);
    return;
  }

  // 情境 E：精準時鐘攔截 (純粹詢問時間日期時 0.01 秒秒回；若帶有複合問題如「新聞」、「推薦」等則交給 Gemini 完整回答)
  const cleanText = userText.replace(/[？\?\s]/g, "").toLowerCase();
  const dateTimeTriggers = [
    "今天幾號", "今天幾月幾號", "今天日期", "現在是哪一年", "今年是哪一年",
    "今年是幾年", "現在是幾年", "現在哪一年", "現在幾點", "現在時間",
    "今天星期幾", "今天禮拜幾", "今天是星期幾", "今天是禮拜幾", "幾月幾號",
    "今年幾年", "現在年份", "今年年份", "今天是什麼日子", "今天是幾號", "今天是哪一年"
  ];

  // 檢查是否包含其他複合需求關鍵字（若有問新聞、稿、為什麼、如何、推薦等，絕不純截斷）
  const complexKeywords = ["新聞", "推薦", "幫我", "怎麼", "如何", "為什麼", "還有", "稿", "事件", "分析", "詳細", "報告", "介紹"];
  let hasComplexQuery = false;
  for (let i = 0; i < complexKeywords.length; i++) {
    if (userText.indexOf(complexKeywords[i]) !== -1) {
      hasComplexQuery = true;
      break;
    }
  }

  const isPureDateQuery = !hasComplexQuery && (
    dateTimeTriggers.indexOf(cleanText) !== -1 ||
    (cleanText.length <= 10 && (
      ((cleanText.indexOf("哪一年") !== -1 || cleanText.indexOf("幾年") !== -1) && (cleanText.indexOf("現在") !== -1 || cleanText.indexOf("今年") !== -1)) ||
      ((cleanText.indexOf("幾號") !== -1 || cleanText.indexOf("日期") !== -1) && (cleanText.indexOf("今天") !== -1 || cleanText.indexOf("現在") !== -1 || cleanText.indexOf("今日") !== -1)) ||
      ((cleanText.indexOf("幾點") !== -1 || cleanText.indexOf("現在時間") !== -1) && (cleanText.indexOf("現在") !== -1 || cleanText.indexOf("目前") !== -1 || cleanText.indexOf("今天") !== -1)) ||
      ((cleanText.indexOf("星期幾") !== -1 || cleanText.indexOf("禮拜幾") !== -1) && (cleanText.indexOf("今天") !== -1 || cleanText.indexOf("今日") !== -1))
    ))
  );

  if (isPureDateQuery) {
    const t = getCurrentTimeInfo();
    const timeReply = (
      "報告主人！⏰ 現在台灣標準時間是：\n\n" +
      "📅 日期：西元 " + t.year + " 年 " + t.month + " 月 " + t.day + " 日（" + t.weekday + "）\n" +
      "🕒 時間：" + t.timeStr + "\n" +
      "✨ 年份：今年是西元 " + t.year + " 年（民國 " + (t.year - 1911) + " 年）\n\n" +
      "小精靈直接調度雲端伺服器時鐘，時間資訊 100% 精準無誤喔！💡"
    );
    sendLineReply(replyToken, timeReply);
    return;
  }

  // 情境 F：正常問題輸入，呼叫 Google Gemini 雲端智慧大腦
  const aiReply = askGeminiBrain(userText);
  sendLineReply(replyToken, aiReply);
}

// ==========================================
// 4. Google Gemini 雲端大腦呼叫模組
// ==========================================

/**
 * 呼叫 Google Gemini API 進行繁體中文智慧推理 (具備 3.8-flash 優先與多重備援)
 */
function askGeminiBrain(userMessage) {
  if (!GEMINI_API_KEY) {
    return "【智聊小精靈提示】\n管理員尚未在 Google Apps Script 中設定 GEMINI_API_KEY，請先前往「專案設定」->「指令碼屬性」填寫金鑰。";
  }

  const timeInfo = getCurrentTimeInfo();

  // 嚴謹的系統提示詞，包含 2026 真實時鐘錨定與長度排版規範
  const systemInstruction = (
    "你是一個聰明、熱心且幽默有禮的 LINE 個人智慧助理，名字叫做「智聊小精靈」。\n" +
    "你目前運行於 Google Apps Script 雲端環境，為使用者提供 24 小時不間斷的智慧陪伴。\n" +
    "【核心真實時間錨定】：\n" +
    "• " + timeInfo.desc + "\n" +
    "• 請絕對牢記當前真實年份是西元 " + timeInfo.year + " 年！\n" +
    "• 當使用者詢問任何與日期、年份、現在時間或最新生活相關之問題，請務必基於上述真實時間回答，嚴禁回答已過時的歷史年份（例如 2023、2024 或 2025 年）。\n" +
    "請一律使用繁體中文（台灣習慣用語與口氣）回覆。\n" +
    "【排版與長度規則】\n" +
    "1. 回覆總長度嚴格控制在 200 至 450 字之間（最長絕不可超過 480 字）。\n" +
    "2. 務必在限制長度內將語意完整表達完畢，以句號結束，切勿中途斷頭。\n" +
    "3. 請勿使用 Markdown 雙星號粗體標籤（例如 **文字**），請改用自然換行或 Emoji 呈現。"
  );

  // 支援的模型佇列：優先呼叫極速 (<1s)、零思維干擾且支援完整繁體中文的 flash-lite 系列，備援 preview/flash
  const candidateModels = [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite-preview',
    'gemini-3.5-flash'
  ];

  for (let i = 0; i < candidateModels.length; i++) {
    const model = candidateModels[i];
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + GEMINI_API_KEY;

    const payload = {
      "systemInstruction": {
        "parts": [{ "text": systemInstruction }]
      },
      "contents": [
        {
          "role": "user",
          "parts": [{ "text": userMessage }]
        }
      ],
      "generationConfig": {
        "temperature": 0.7,
        "maxOutputTokens": 800
      }
    };

    const options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    try {
      const response = UrlFetchApp.fetch(url, options);
      const statusCode = response.getResponseCode();
      const resultJson = JSON.parse(response.getContentText());

      if (statusCode === 200 && resultJson.candidates && resultJson.candidates.length > 0) {
        const candidate = resultJson.candidates[0];
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
          // 過濾排除思考鏈 (thought: true)，只提取真實對使用者的回覆內容
          let extractedText = "";
          for (let p = 0; p < candidate.content.parts.length; p++) {
            const part = candidate.content.parts[p];
            if (!part.thought && part.text) {
              extractedText += part.text;
            }
          }
          if (!extractedText && candidate.content.parts[0].text) {
            extractedText = candidate.content.parts[0].text;
          }

          const formatted = formatReplyText(extractedText);
          if (formatted) {
            return formatted;
          }
        }
      }

      console.warn("模型 " + model + " 回應異常 (狀態碼 " + statusCode + "): " + response.getContentText());
    } catch (err) {
      console.error("呼叫模型 " + model + " 發生例外: " + err);
    }
  }

  return "抱歉，小精靈的大腦剛剛連線稍微忙碌了一下，請稍候再問我一次喔！😄";
}

// ==========================================
// 5. LINE 回覆與工具函式
// ==========================================

/**
 * 立即在使用者手機聊天室顯示「正在輸入... / 讀取中動畫 (Loading Animation)」
 * 讓使用者立刻知道機器人有收到訊息並正在運算，0 秒即刻反饋
 */
function sendLoadingAnimation(chatId) {
  if (!CHANNEL_ACCESS_TOKEN || !chatId) return;
  const url = "https://api.line.me/v2/bot/chat/loading/start";
  const payload = {
    "chatId": chatId,
    "loadingSeconds": 15
  };
  const options = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + CHANNEL_ACCESS_TOKEN
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  try {
    UrlFetchApp.fetch(url, options);
  } catch (err) {
    // 忽略動畫失敗
  }
}

/**
 * 呼叫 LINE Messaging API Reply 訊息回覆端點
 */
function sendLineReply(replyToken, messageText) {
  if (!CHANNEL_ACCESS_TOKEN) {
    console.error("未設定 CHANNEL_ACCESS_TOKEN，無法發送 LINE 回覆！");
    return;
  }

  const url = "https://api.line.me/v2/bot/message/reply";
  const payload = {
    "replyToken": replyToken,
    "messages": [
      {
        "type": "text",
        "text": messageText
      }
    ]
  };

  const options = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + CHANNEL_ACCESS_TOKEN
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    if (code === 200) {
      console.log("✅ 成功發送 LINE 回覆訊息給使用者！長度: " + messageText.length + " 字");
    } else {
      console.error("❌ LINE 回覆 API 失敗 (HTTP " + code + "): " + response.getContentText());
    }
  } catch (err) {
    console.error("❌ LINE 發送例外: " + err);
  }
}

/**
 * 清理 Markdown 標籤、防禦內部英文草稿洩漏並在句末安全截斷
 */
function formatReplyText(text) {
  if (!text) return "";
  let clean = text.trim().replace(/\*\*/g, "");

  // 防禦：檢查是否為模型內部洩漏的英文思考草稿 (例如 "standard response tailored for..." 或截斷的英文思考片段)
  const hasChinese = /[\u4e00-\u9fa5]/.test(clean);
  const looksLikeThoughtLeak = /^(standard response|thinking|tailored for|here is a|draft|exact city)/i.test(clean);
  if (!hasChinese && (looksLikeThoughtLeak || clean.length < 150)) {
    console.warn("偵測到疑似內部思考片段或非中文回覆，已略過此回應: " + clean.substring(0, 50));
    return ""; // 回傳空字串讓外層迴圈調用下一個備援模型
  }

  if (clean.length > 480) {
    let truncated = clean.substring(0, 475);
    const lastPunct = Math.max(
      truncated.lastIndexOf("。"),
      truncated.lastIndexOf("！"),
      truncated.lastIndexOf("？"),
      truncated.lastIndexOf("\n")
    );
    if (lastPunct > 200) {
      clean = truncated.substring(0, lastPunct + 1);
    } else {
      clean = truncated + "...";
    }
  }
  return clean;
}

/**
 * 取得當前台北時間物件與格式化文字
 */
function getCurrentTimeInfo() {
  const now = new Date();
  const timeZone = "Asia/Taipei";
  const yearStr = Utilities.formatDate(now, timeZone, "yyyy");
  const monthStr = Utilities.formatDate(now, timeZone, "MM");
  const dayStr = Utilities.formatDate(now, timeZone, "dd");
  const timeStr = Utilities.formatDate(now, timeZone, "HH:mm:ss");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const weekday = weekdays[now.getDay()];

  const desc = "當前真實系統時間為：西元 " + year + " 年 " + month + " 月 " + day + " 日 " + timeStr + "（" + weekday + "），今年是西元 " + year + " 年（民國 " + (year - 1911) + " 年）。";

  return {
    now: now,
    year: year,
    month: month,
    day: day,
    weekday: weekday,
    timeStr: timeStr,
    desc: desc,
    fullStr: year + "年" + month + "月" + day + "日 " + timeStr + " (" + weekday + ")"
  };
}

/**
 * 檢查是否為純 Emoji 訊息
 */
function isPureEmoji(str) {
  const emojiRegex = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\s]+$/u;
  return emojiRegex.test(str);
}

/**
 * 驗證 LINE Webhook HMAC-SHA256 簽章
 */
function verifyLineSignature(body, signature, channelSecret) {
  try {
    const signatureBytes = Utilities.computeHmacSha256Signature(body, channelSecret);
    const calculatedSignature = Utilities.base64Encode(signatureBytes);
    return calculatedSignature === signature;
  } catch (err) {
    console.error("驗證簽章錯誤: " + err);
    return false;
  }
}
