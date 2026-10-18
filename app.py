import io
import os
import sys
import json
import threading
import requests
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, abort, jsonify

# Windows 終端機 UTF-8 編碼修正，避免輸出 emoji 時引發 cp950 編碼崩潰
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import (
    Configuration,
    ApiClient,
    MessagingApi,
    ReplyMessageRequest,
    TextMessage,
)
from linebot.v3.webhooks import (
    MessageEvent,
    TextMessageContent,
    StickerMessageContent,
    ImageMessageContent,
    AudioMessageContent,
    VideoMessageContent,
    LocationMessageContent,
    FileMessageContent,
)

from google import genai
from google.genai import types

# 載入 .env 環境變數
load_dotenv(override=True)

channel_secret = os.getenv("LINE_CHANNEL_SECRET")
channel_access_token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN")
gemini_api_key = os.getenv("GEMINI_API_KEY")
ollama_api_url = os.getenv("OLLAMA_API_URL", "http://localhost:11434")
local_model_name = os.getenv("LOCAL_MODEL_NAME", "qwen2.5:3b")
port = int(os.getenv("PORT", 5000))

app = Flask(__name__)

# LINE 設定
handler = WebhookHandler(channel_secret) if channel_secret else None
configuration = (
    Configuration(access_token=channel_access_token)
    if channel_access_token
    else None
)

# Gemini AI 雲端備援客戶端
gemini_client = genai.Client(api_key=gemini_api_key) if gemini_api_key else None


def send_line_reply(reply_token: str, message_text: str):
    """封裝 LINE 訊息回覆邏輯"""
    if not configuration:
        app.logger.error("伺服器缺少 LINE configuration 設定，無法回覆")
        return
    try:
        with ApiClient(configuration) as api_client:
            line_bot_api = MessagingApi(api_client)
            line_bot_api.reply_message(
                ReplyMessageRequest(
                    reply_token=reply_token,
                    messages=[TextMessage(text=message_text)],
                )
            )
            print(f"✅ 成功發送 LINE 回覆訊息給使用者！長度: {len(message_text)} 字", flush=True)
    except Exception as err:
        app.logger.error(f"❌ 傳送 LINE 回覆訊息失敗: {err}")
        print(f"❌ 傳送 LINE 回覆訊息失敗: {err}", flush=True)


def format_reply_text(text: str) -> str:
    """後處理：移除 Markdown 粗體星號，並在 500 字上限內進行標點符號安全截斷"""
    if not text:
        return ""
    text = text.strip().replace("**", "")
    if len(text) > 500:
        truncated = text[:495]
        last_punct = max(
            truncated.rfind("。"),
            truncated.rfind("！"),
            truncated.rfind("？"),
            truncated.rfind("\n"),
        )
        if last_punct > 250:
            text = truncated[: last_punct + 1]
        else:
            text = truncated + "..."
    return text


def get_current_time_context() -> tuple[str, datetime]:
    """取得當前本機真實時間與台灣繁體中文排版資訊"""
    now = datetime.now()
    now_str = now.strftime("%Y年%m月%d日 %H:%M")
    weekday_map = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
    weekday_str = weekday_map[now.weekday()]
    desc = f"當前真實本機系統時間為：{now_str}（{weekday_str}），今年是西元 {now.year} 年（民國 {now.year - 1911} 年）。"
    return desc, now


def search_web_context(query: str, max_results: int = 3) -> str:
    """即時網際網路搜尋：爬取最新網路資訊與新聞摘要 (Search Grounding)"""
    try:
        from ddgs import DDGS
        now = datetime.now()
        current_year = str(now.year)

        # 搜尋優化：若查詢詢問時事、最新動態且未指明年份，自動加入當前年份以確保搜尋時效性
        search_query = query.encode("utf-8", "ignore").decode("utf-8")
        time_related_terms = ["最新", "新聞", "今天", "現在", "時事", "流行", "熱門", "科技", "趨勢", "活動", "天氣"]
        if any(term in search_query for term in time_related_terms) and current_year not in search_query:
            search_query = f"{current_year} {search_query}"

        with DDGS() as ddgs:
            results = list(ddgs.text(search_query, max_results=max_results))
            if not results and search_query != query:
                results = list(ddgs.text(query, max_results=max_results))
            if not results:
                return ""
            snippets = []
            for r in results:
                title = r.get("title", "").strip()
                body = r.get("body", "").strip()
                if title or body:
                    snippets.append(f"• {title}: {body}")
            return "\n".join(snippets)
    except Exception as e:
        app.logger.warning(f"即時聯網搜尋暫時無法取得結果: {e}")
        return ""


def ask_local_qwen(user_message: str, web_context: str = "") -> str:
    """
    第一優先：呼叫本機運行的 Ollama Qwen 2.5 3B 模型
    - 運行於本機 RTX 3050 GPU (4GB VRAM)，完全免費無額度上限
    - 結合即時聯網搜尋資料與真實系統時間錨定，徹底杜絕時間穿越與知識過時問題
    """
    time_info, now = get_current_time_context()
    system_prompt = (
        "你是一個聰明、熱心且幽默有禮的 LINE 個人智慧助理，名字叫做「智聊小精靈」。\n"
        "你目前運行於使用者的本地 GPU (RTX 3050) 上，並具備即時網際網路檢索能力。\n"
        f"【核心真實時間錨定】：\n"
        f"• {time_info}\n"
        f"• 請絕對牢記當前真實年份是西元 {now.year} 年！\n"
        f"• 當使用者詢問任何與日期、年份、現在時間或最新時事相關之問題，請務必基於上述真實時間與檢索資料回答，嚴禁回答已過時的歷史年份（例如 2023、2024 或 2025 年）。\n"
        "請一律使用繁體中文（台灣習慣語境）回覆。\n"
        "【排版與長度規則】\n"
        "1. 回覆總長度控制在 180 至 450 字之間（最長絕對不可超過 500 字）。\n"
        "2. 務必在限制長度內將語意完整表達完畢，以句號結束，切勿中途斷頭。\n"
        "3. 請勿使用 Markdown 的雙星號粗體標籤（例如 **文字**），請改用自然換行或 Emoji 呈現。\n"
        "4. 若有提供即時網路搜尋資料，請依據最新資訊回答，確保時效性。"
    )

    content = user_message
    if web_context:
        content = (
            f"【即時網路搜尋參考資料】：\n{web_context}\n\n"
            f"【使用者問題】：\n{user_message}"
        )

    payload = {
        "model": local_model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content},
        ],
        "stream": False,
        "options": {
            "temperature": 0.7,
            "num_predict": 300,
        },
    }

    resp = requests.post(
        f"{ollama_api_url}/api/chat", json=payload, timeout=35
    )
    if resp.status_code == 200:
        raw_text = resp.json().get("message", {}).get("content", "")
        return format_reply_text(raw_text)
    else:
        raise RuntimeError(f"Ollama 回應狀態碼異常: {resp.status_code}")


def ask_gemini(user_message: str, web_context: str = "") -> str:
    """第二備援：呼叫 Google Gemini 雲端模型佇列"""
    global gemini_client
    current_key = os.getenv("GEMINI_API_KEY")
    if not gemini_client and current_key:
        gemini_client = genai.Client(api_key=current_key)

    if not gemini_client or not current_key:
        return (
            "【AI 智慧助理提示】\n"
            "尚未設定 GEMINI_API_KEY，且本地模型暫時未連通！"
        )

    time_info, now = get_current_time_context()
    system_prompt = (
        "你是一個聰明、熱心且幽默有禮的 LINE 個人智慧助理，名字叫做「智聊小精靈」。\n"
        f"【核心真實時間錨定】：\n"
        f"• {time_info}\n"
        f"• 當前是西元 {now.year} 年！請務必以此真實時間基準為準，絕對不可回答已過時的歷史年份（例如 2023、2024 或 2025 年）。\n"
        "請一律使用繁體中文（台灣繁體習慣）回覆。\n"
        "【排版與長度規則】\n"
        "1. 回覆總長度控制在 200 至 450 字之間（最長不可超過 500 字）。\n"
        "2. 務必在限制長度內把語意完整表達完畢，以完整的句子句號結束。\n"
        "3. 請勿使用 Markdown 雙星號粗體標籤（**文字**），改用自然換行與 Emoji 呈現。"
    )

    contents_payload = user_message
    if web_context:
        contents_payload = (
            f"【即時網路搜尋參考資料】：\n{web_context}\n\n"
            f"【使用者問題】：\n{user_message}"
        )

    models_to_try = [
        "gemini-flash-latest",
        "gemini-3.8-flash",
        "gemini-3.5-flash",
        "gemini-flash-lite-latest",
    ]

    for model_name in models_to_try:
        try:
            response = gemini_client.models.generate_content(
                model=model_name,
                contents=contents_payload,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    max_output_tokens=2048,
                ),
            )
            if response and response.text:
                return format_reply_text(response.text)
        except Exception as e:
            app.logger.warning(f"嘗試雲端模型 {model_name} 失敗: {e}，切換備用...")
            continue

    return "抱歉，AI 大腦目前暫時連線繁忙，請稍候再試一次！"


def ask_ai_brain(user_message: str) -> str:
    """
    雙大腦智慧調度架構：
    1. 針對需要實效性之問題，自動觸發即時網路搜尋 (Web Search Grounding)
    2. 優先調度本地 GPU 運行的 Qwen 2.5 3B (無限額度、具備 2026 時效資訊)
    3. 若本地服務離線或發生錯誤，自動無縫切換至 Google Gemini 雲端備援佇列
    """
    web_context = ""
    # 若直接詢問純時間日期，不需網路搜尋干擾
    clean_q = user_message.replace("？", "").replace("?", "").replace(" ", "").strip()
    direct_date_words = ["今天幾號", "今天幾月幾號", "今天日期", "現在是哪一年", "今年是哪一年", "現在幾點", "現在時間", "今天星期幾"]
    is_direct_date = any(clean_q == w for w in direct_date_words)

    if not is_direct_date:
        search_keywords = [
            "天氣", "新聞", "今天", "明天", "昨天", "最新", "現在",
            "2026", "2025", "股價", "匯率", "推薦", "什麼", "誰是", "哪裡", "多少", "活動", "時事"
        ]
        if any(k in user_message for k in search_keywords) or len(user_message) >= 4:
            try:
                web_context = search_web_context(user_message, max_results=2)
            except Exception as err:
                app.logger.warning(f"聯網檢索跳過: {err}")

    # 1. 嘗試呼叫本地 Qwen 2.5 模型
    try:
        reply = ask_local_qwen(user_message, web_context)
        if reply:
            return reply
    except Exception as local_err:
        app.logger.warning(
            f"本地 Qwen 2.5 調度未成功 ({local_err})，無縫切換至 Google Gemini 雲端備援..."
        )

    # 2. 本地不可用時，無縫回退至 Google Gemini 雲端
    return ask_gemini(user_message, web_context)


@app.route("/", methods=["GET"])
def index():
    return "智聊小精靈 (LINE Smart Bot - Local Qwen 2.5 + Web Search + Gemini Backup) 運作中！"


@app.route("/health", methods=["GET"])
def health():
    # 檢測本地 Ollama 連線狀態
    local_online = False
    try:
        res = requests.get(f"{ollama_api_url}/api/tags", timeout=1.5)
        local_online = res.status_code == 200
    except Exception:
        local_online = False

    return jsonify(
        {
            "status": "ok",
            "version": "1.2.0-local-qwen-websearch",
            "local_ai": {
                "engine": "Ollama",
                "model": local_model_name,
                "online": local_online,
            },
            "web_search": {
                "engine": "ddgs",
                "enabled": True,
            },
            "cloud_backup": {
                "has_gemini_key": bool(os.getenv("GEMINI_API_KEY")),
            },
            "line_credentials": {
                "has_secret": bool(channel_secret),
                "has_token": bool(channel_access_token),
            },
        }
    )


def process_webhook_async(body: str, signature: str):
    """背景非同步執行事件處理，避免阻塞 LINE Webhook 連線"""
    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        app.logger.warning("無效的簽章，拒絕請求。")
        print("⚠️ 收到無效的 LINE 簽章，已拒絕！")
    except Exception as e:
        app.logger.error(f"非同步處理事件時發生錯誤: {e}")
        print(f"❌ 處理事件時發生錯誤: {e}")


@app.route("/callback", methods=["POST"])
def callback():
    if not handler or not configuration:
        return "伺服器尚未設定 LINE 金鑰", 500

    signature = request.headers.get("X-Line-Signature", "")
    body = request.get_data(as_text=True)

    app.logger.info("Request body received, delegating to worker thread...")

    # 立刻啟動背景執行緒處理 AI 推論與回覆，並在 50ms 內回傳 200 OK 給 LINE，徹底解決 LINE 官方超時中斷問題
    threading.Thread(
        target=process_webhook_async,
        args=(body, signature),
        daemon=True
    ).start()

    return "OK", 200


# 註冊訊息處理器
if handler:

    # 1. 文字訊息處理器 (本地 AI + 聯網檢索 + 輸入防呆引導 + 離線指令)
    @handler.add(MessageEvent, message=TextMessageContent)
    def handle_message(event):
        raw_text = event.message.text
        user_text = raw_text.strip() if raw_text else ""

        # 情境 A：空白或純空白輸入處理 (輸入不完整)
        if not user_text:
            reply = (
                "【智聊小精靈提示】\n"
                "您輸入的訊息好像是空白的喔！請輸入您想詢問的內容，例如：\n"
                "• 「台北今天天氣如何？」\n"
                "• 「請推薦 3 個台北安靜咖啡廳」\n"
                "💡 輸入「說明」可查看完整使用指南！"
            )
            send_line_reply(event.reply_token, reply)
            return

        # 情境 B：純表情符號 (emoji) 或 (emoji) 標籤，已讀不回
        if user_text == "(emoji)" or (
            hasattr(event.message, "emojis")
            and event.message.emojis
            and not user_text.replace("(emoji)", "").strip()
        ):
            try:
                print(f"收到來自使用者 [{event.source.user_id}] 的純 Emoji 表情符號，已讀不回覆。")
            except Exception:
                pass
            return

        # 情境 C：內建功能指令 (說明 / help)
        if user_text.lower() in ["說明", "功能", "指令", "help", "/help", "指南"]:
            guide = (
                "🤖【智聊小精靈 v1.2 升級版指南】\n\n"
                "我已升級為「本地 GPU 模型 (Qwen 2.5) + 即時聯網搜尋」生活智慧助理！\n\n"
                "✨【升級特色】\n"
                "1. 即時聯網：可詢問 2026 最新天氣、即時新聞與生活動態！\n"
                "2. 本地運算：由本機 RTX 3050 顯卡驅動，零 API 限制！\n"
                "3. 雲端雙備援：若本機離線，自動無縫切換 Google Gemini！\n\n"
                "💡【推薦試試】\n"
                "• 「台北今天天氣如何？」\n"
                "• 「2026年最新熱門科技話題」\n"
                "• 「推薦適合閱讀的安靜咖啡廳」"
            )
            send_line_reply(event.reply_token, guide)
            return

        # 情境 D：輸入不完整 / 模糊關鍵字引導提醒
        incomplete_dict = {
            "推薦": (
                "哈囉！收到您的「推薦」需求～請問您想要哪一種類型的推薦呢？😄\n\n"
                "1. 🍽️ 美食餐廳（請提供地點、預算或料理類型）\n"
                "2. 🏖️ 旅遊景點（請提供天數、縣市或旅行偏好）\n"
                "3. 🎬 電影書籍（請提供喜愛的題材類型）\n\n"
                "請補充詳細一點的線索，小精靈就能為您量身打造精準推薦喔！✨"
            ),
            "幫我": (
                "沒問題！小精靈隨時為您服務 🙋‍♂️\n\n"
                "請告訴我具體需要幫忙的事情，例如：\n"
                "• 「幫我寫一封求職感謝信」\n"
                "• 「幫我翻譯這段英文」\n"
                "• 「幫我規劃 3 天 2 夜行程」\n\n"
                "請直接把您的詳細需求告訴我即可！💡"
            ),
            "查詢": (
                "請問您想查詢什麼資訊呢？請告訴我關鍵字，例如「查詢台北今天天氣」或「查詢機器學習定義」！💡"
            ),
        }

        if user_text in incomplete_dict:
            send_line_reply(event.reply_token, incomplete_dict[user_text])
            return

        # 短字問候快速引導
        if user_text.lower() in ["你好", "您好", "嗨", "hi", "hello", "在嗎", "安安"]:
            greeting = (
                "嗨！我是「智聊小精靈」✨\n"
                "我現在具備本地 Qwen 2.5 雙大腦與即時網路搜尋能力！\n"
                "今天有什麼想查詢或聊聊的嗎？輸入「說明」可看完整功能清單喔！"
            )
            send_line_reply(event.reply_token, greeting)
            return

        # 情境 E：精準即時時間與日期查詢（直球回答，0 秒延遲且 100% 精準對齊本機時鐘）
        clean_text = user_text.replace("？", "").replace("?", "").replace(" ", "").lower()
        date_time_triggers = [
            "今天幾號", "今天幾月幾號", "今天日期", "現在是哪一年", "今年是哪一年",
            "今年是幾年", "現在是幾年", "現在哪一年", "現在幾點", "現在時間",
            "今天星期幾", "今天禮拜幾", "今天是星期幾", "今天是禮拜幾", "幾月幾號",
            "今年幾年", "現在年份", "今年年份", "今天是什麼日子", "今天是幾號", "今天是哪一年"
        ]
        is_date_query = (
            clean_text in date_time_triggers
            or (("哪一年" in clean_text or "幾年" in clean_text) and any(w in clean_text for w in ["現在", "今年", "這一年"]))
            or (("幾號" in clean_text or "日期" in clean_text) and any(w in clean_text for w in ["今天", "現在", "今日"]))
            or (("幾點" in clean_text or "現在時間" in clean_text) and any(w in clean_text for w in ["現在", "目前", "今天"]))
            or (("星期幾" in clean_text or "禮拜幾" in clean_text) and any(w in clean_text for w in ["今天", "今日"]))
        )
        if is_date_query:
            now = datetime.now()
            weekday_map = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
            weekday_str = weekday_map[now.weekday()]
            time_reply = (
                f"報告主人！⏰ 現在本機的真實時間是：\n\n"
                f"📅 日期：西元 {now.year} 年 {now.month} 月 {now.day} 日（{weekday_str}）\n"
                f"🕒 時間：{now.strftime('%H:%M:%S')}\n"
                f"✨ 年份：今年是西元 {now.year} 年（民國 {now.year - 1911} 年）\n\n"
                f"小精靈直接調度本機即時時鐘，精準無誤，絕不時間錯亂喔！💡"
            )
            send_line_reply(event.reply_token, time_reply)
            return

        # 情境 F：正常問題輸入，呼叫雙大腦 (本地 Qwen 2.5 優先 + 聯網搜尋 ➜ 雲端 Gemini 備援)
        try:
            print(f"收到來自使用者 [{event.source.user_id}] 的問題: {user_text}", flush=True)
        except Exception:
            pass

        ai_reply = ask_ai_brain(user_text)

        try:
            print(f"AI 回覆: {ai_reply[:60]}...", flush=True)
        except Exception:
            pass

        send_line_reply(event.reply_token, ai_reply)

    # 2. 貼圖訊息處理器 (收到貼圖已讀不回)
    @handler.add(MessageEvent, message=StickerMessageContent)
    def handle_sticker_message(event):
        try:
            print(
                f"收到來自使用者 [{event.source.user_id}] 的貼圖 (package: {event.message.package_id}, sticker: {event.message.sticker_id})，已讀不回覆。"
            )
        except Exception:
            pass
        return

    # 3. 不支援的訊息格式處理器：圖片訊息
    @handler.add(MessageEvent, message=ImageMessageContent)
    def handle_image_message(event):
        hint = (
            "【智聊小精靈使用提示】📷\n"
            "收到您的圖片囉！目前升級版主要專注於文字智慧問答與即時生活搜尋，尚未支援圖片視覺辨識分析功能。\n\n"
            "請直接以文字輸入您的問題與我互動～💡\n"
            "（輸入「說明」可查看支援的功能清單）"
        )
        send_line_reply(event.reply_token, hint)

    # 4. 不支援的訊息格式處理器：語音訊息
    @handler.add(MessageEvent, message=AudioMessageContent)
    def handle_audio_message(event):
        hint = (
            "【智聊小精靈使用提示】🎙️\n"
            "收到您的語音訊息！目前小精靈僅支援文字訊息交流，暫不支援語音辨識喔。\n\n"
            "請改用文字輸入告訴我您的問題，我會立刻為您解答！"
        )
        send_line_reply(event.reply_token, hint)

    # 5. 不支援的訊息格式處理器：影片訊息
    @handler.add(MessageEvent, message=VideoMessageContent)
    def handle_video_message(event):
        hint = (
            "【智聊小精靈使用提示】🎥\n"
            "收到您的影片！目前小精靈暫不支援影片解析功能，請直接輸入文字與我對話～"
        )
        send_line_reply(event.reply_token, hint)

    # 6. 不支援的訊息格式處理器：地理位置訊息
    @handler.add(MessageEvent, message=LocationMessageContent)
    def handle_location_message(event):
        hint = (
            "【智聊小精靈使用提示】📍\n"
            "收到位置資訊！目前小精靈暫不支援即時定位分析，請直接打字告訴我您想查詢的地點或附近景點（例如：「推薦台北信義區美食」）！"
        )
        send_line_reply(event.reply_token, hint)

    # 7. 不支援的訊息格式處理器：檔案訊息
    @handler.add(MessageEvent, message=FileMessageContent)
    def handle_file_message(event):
        hint = (
            "【智聊小精靈使用提示】📁\n"
            "收到檔案！目前小精靈暫不支援文件讀取，請直接複製檔案內的文字內容發送給我，我立刻幫您整理或分析！"
        )
        send_line_reply(event.reply_token, hint)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ["--cli", "-c", "cli"]:
        print("=" * 55)
        print("🤖【智聊小精靈 - 關卡 A 終端機模擬對話模式】")
        print("不用接 LINE、不用開穿透通道，直接在終端機與本地 Qwen 2.5 模型對話！")
        print("輸入 'exit' 或 'quit' 即可離開。")
        print("=" * 55 + "\n")
        while True:
            try:
                user_input = input("你：").strip()
                if not user_input:
                    continue
                if user_input.lower() in ["exit", "quit", "離開"]:
                    break
                print("\n[智聊小精靈思考中...]", flush=True)
                reply = ask_ai_brain(user_input)
                print(f"\n小精靈：\n{reply}\n")
            except (KeyboardInterrupt, EOFError):
                break
        print("\n已結束終端機模擬模式。")
        sys.exit(0)

    app.run(host="0.0.0.0", port=port, debug=True)
