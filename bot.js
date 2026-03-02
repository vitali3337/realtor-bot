require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");

// ===== КОНФИГ =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_ID = "-1003773163201";

if (!TELEGRAM_TOKEN) { console.error("TELEGRAM_TOKEN не найден"); process.exit(1); }
if (!ANTHROPIC_KEY) { console.error("ANTHROPIC_API_KEY не найден"); process.exit(1); }

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ===== СИСТЕМНЫЙ ПРОМПТ PRO =====
const SYSTEM_PROMPT = `
Ты — профессиональный менеджер агентства недвижимости Real Invest в Приднестровье.

Твоя задача — мягко довести клиента до передачи номера телефона.

Алгоритм:
1. Сначала уточни потребность (район, бюджет, комнаты).
2. Дай короткий экспертный комментарий по рынку.
3. Скажи, что есть подходящие варианты.
4. Только после 2–3 сообщений попроси номер телефона.

ВАЖНО:
- НЕ проси номер сразу.
- Не пиши фразу "После этого напишите номер".
- Пиши максимум 4 коротких предложения.
- Общайся живо и уверенно.
- Всегда на русском языке.
`;

// ===== ПАМЯТЬ =====
const conversations = {};
const users = {};

function getHistory(chatId) {
  if (!conversations[chatId]) conversations[chatId] = [];
  return conversations[chatId];
}

function addToHistory(chatId, role, text) {
  const history = getHistory(chatId);
  history.push({ role, content: text });
  if (history.length > 20) history.splice(0, history.length - 20);
}

// ===== КНОПКИ =====
const keyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["🏢 Сдать недвижимость", "🔑 Снять недвижимость"],
      ["📄 Документы", "📞 Связаться"]
    ],
    resize_keyboard: true
  }
};

// ===== CLAUDE =====
async function askClaude(chatId, message) {
  addToHistory(chatId, "user", message);

  const formatted = getHistory(chatId).map(m => ({
    role: m.role,
    content: [{ type: "text", text: m.content }]
  }));

  const response = await client.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: formatted
  });

  const reply = response.content[0]?.text || "Нет ответа.";
  addToHistory(chatId, "assistant", reply);
  return reply;
}

// ===== ОТПРАВКА ЛИДА =====
async function sendLead(msg, phone) {
  const history = getHistory(msg.chat.id)
    .filter(m => m.role === "user")
    .map(m => m.content)
    .slice(-5)
    .join(" | ");

  await bot.sendMessage(
    ADMIN_ID,
    `📥 Новая заявка\n\n` +
    `👤 ${msg.from.first_name}\n` +
    `📎 ${msg.from.username ? "@" + msg.from.username : "без username"}\n` +
    `🆔 ${msg.from.id}\n` +
    `📱 ${phone}\n\n` +
    `📝 ${history}`
  );
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
  conversations[msg.chat.id] = [];
  bot.sendMessage(
    msg.chat.id,
    `Здравствуйте 👋\n\nЯ помощник агентства Real Invest.\nПомогу купить, продать, сдать или снять недвижимость.\n\nВыберите действие:`,
    keyboard
  );
});

// ===== CLEAR =====
bot.onText(/\/clear/, (msg) => {
  conversations[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, "Диалог очищен.", keyboard);
});

// ===== ОСНОВНОЙ ОБРАБОТЧИК =====
bot.on("message", async (msg) => {
  if (msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  const actions = {
    "🏠 Купить недвижимость": "Клиент хочет купить недвижимость.",
    "🏷 Продать недвижимость": "Клиент хочет продать недвижимость.",
    "🏢 Сдать недвижимость": "Клиент хочет сдать недвижимость.",
    "🔑 Снять недвижимость": "Клиент хочет снять недвижимость.",
    "📄 Документы": "Клиент спрашивает про документы при сделке.",
    "📞 Связаться": "Клиент хочет связаться с менеджером."
  };

  if (actions[text]) {
    try {
      bot.sendChatAction(chatId, "typing");
      const reply = await askClaude(chatId, actions[text]);
      return bot.sendMessage(chatId, reply, keyboard);
    } catch (e) {
      console.error(e);
      return bot.sendMessage(chatId, "Ошибка. Попробуйте ещё раз.", keyboard);
    }
  }

  // Если номер телефона
  if (/^\+?\d[\d\s\-]{5,}$/.test(text)) {
    try {
      await sendLead(msg, text);
      conversations[chatId] = [];
      return bot.sendMessage(chatId, "✅ Спасибо! Менеджер свяжется с вами.", keyboard);
    } catch (e) {
      console.error(e);
      return bot.sendMessage(chatId, "Ошибка отправки заявки.", keyboard);
    }
  }

  // Обычный текст
  try {
    bot.sendChatAction(chatId, "typing");
    const reply = await askClaude(chatId, text);
    return bot.sendMessage(chatId, reply, keyboard);
  } catch (e) {
    console.error(e);
    return bot.sendMessage(chatId, "Произошла ошибка.", keyboard);
  }
});

console.log("🚀 Real Invest PRO бот запущен");
