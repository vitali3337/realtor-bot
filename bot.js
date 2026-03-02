require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");

// ===== КОНФИГУРАЦИЯ =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const ADMIN_ID       = "-1003773163201"; // твоя группа

if (!TELEGRAM_TOKEN) { console.error("❌ TELEGRAM_TOKEN не найден"); process.exit(1); }
if (!ANTHROPIC_KEY)  { console.error("❌ ANTHROPIC_API_KEY не найден"); process.exit(1); }

const bot    = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ===== СИСТЕМНЫЙ ПРОМПТ =====
const SYSTEM_PROMPT = `
Ты — вежливый помощник агентства недвижимости Real Invest в Приднестровье.

Твои задачи:
- Помогать купить, продать, снять или сдать недвижимость
- Отвечать на вопросы о сделках и документах
- Рассчитывать ипотеку если просят
- Если клиент готов — попросить номер телефона

Правила:
- Отвечай коротко (до 4 предложений)
- Используй эмодзи умеренно
- Всегда отвечай на русском языке
- Если вопрос сложный юридический — предложи консультацию менеджера
`;

// ===== ХРАНИЛИЩЕ =====
const users = {};
const conversations = {};

function getHistory(chatId) {
  if (!conversations[chatId]) conversations[chatId] = [];
  return conversations[chatId];
}

function addToHistory(chatId, role, content) {
  const history = getHistory(chatId);
  history.push({ role, content });
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
}

// ===== КНОПКИ =====
const keyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["🏢 Сдать недвижимость",  "🔑 Снять недвижимость"],
      ["📄 Документы", "📞 Связаться с менеджером"]
    ],
    resize_keyboard: true
  }
};

// ===== CLAUDE =====
async function askClaude(chatId, userMessage) {
  addToHistory(chatId, "user", userMessage);

  const formattedMessages = getHistory(chatId).map(m => ({
    role: m.role,
    content: [{ type: "text", text: m.content }]
  }));

  const response = await client.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: formattedMessages,
  });

  const reply = response.content[0]?.text || "Нет ответа.";
  addToHistory(chatId, "assistant", reply);

  return reply;
}

// ===== ОТПРАВКА ЗАЯВКИ =====
async function sendLead(msg, phone) {
  const u = users[msg.chat.id] || {};

  await bot.sendMessage(
    ADMIN_ID,
    `📥 Новая заявка!\n\n` +
    `📌 Тип: ${u.type || "Не указан"}\n` +
    `👤 Имя: ${msg.from.first_name || "—"}\n` +
    `📎 Username: ${msg.from.username ? "@" + msg.from.username : "нет"}\n` +
    `🆔 ID: ${msg.from.id}\n` +
    `📱 Телефон: ${phone}\n` +
    (u.info ? `📝 Детали: ${u.info}` : "")
  );
}

// ===== /start =====
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || "";
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];

  bot.sendMessage(
    msg.chat.id,
    `Здравствуйте${name ? ", " + name : ""}! 👋\n\n` +
    `Я помощник агентства Real Invest 🏠\n` +
    `Помогу купить, продать, сдать или снять недвижимость.\n\n` +
    `Выберите действие или задайте вопрос:`,
    keyboard
  );
});

// ===== /clear =====
bot.onText(/\/clear/, (msg) => {
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, "Начинаем заново 👍", keyboard);
});

// ===== ОСНОВНОЙ ОБРАБОТЧИК =====
bot.on("message", async (msg) => {
  if (msg.chat.type !== "private") return;

  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  const quickActions = {
    "🏠 Купить недвижимость": "Клиент хочет купить недвижимость. Спроси район, бюджет и количество комнат.",
    "🏷 Продать недвижимость": "Клиент хочет продать недвижимость. Спроси район, площадь и желаемую цену.",
    "🏢 Сдать недвижимость": "Клиент хочет сдать недвижимость. Спроси район, количество комнат и цену аренды.",
    "🔑 Снять недвижимость": "Клиент хочет снять недвижимость. Спроси район, бюджет и количество комнат.",
    "📄 Документы": "Расскажи кратко какие документы нужны для покупки и продажи недвижимости в ПМР.",
    "📞 Связаться с менеджером": "Клиент хочет связаться с менеджером. Попроси номер телефона."
  };

  // Быстрые кнопки
  if (quickActions[text]) {
    users[chatId] = { type: text };
    try {
      bot.sendChatAction(chatId, "typing");
      const reply = await askClaude(chatId, quickActions[text]);
      return bot.sendMessage(chatId, reply, keyboard);
    } catch (e) {
      console.error(e);
      return bot.sendMessage(chatId, "Ошибка. Попробуйте ещё раз.", keyboard);
    }
  }

  // Если отправили телефон
  if (/^\+?\d[\d\s\-]{5,}$/.test(text)) {
    try {
      const history = getHistory(chatId)
        .filter(m => m.role === "user")
        .map(m => m.content)
        .slice(-4)
        .join(" | ");

      if (users[chatId]) users[chatId].info = history;

      await sendLead(msg, text);

      delete users[chatId];
      conversations[chatId] = [];

      return bot.sendMessage(
        chatId,
        "✅ Спасибо! Менеджер свяжется с вами в ближайшее время.",
        keyboard
      );
    } catch (e) {
      console.error(e);
      return bot.sendMessage(chatId, "Ошибка отправки заявки.", keyboard);
    }
  }

  // Любой другой текст — отвечает Claude
  try {
    bot.sendChatAction(chatId, "typing");

    const typingInterval = setInterval(() => {
      bot.sendChatAction(chatId, "typing");
    }, 4000);

    const reply = await askClaude(chatId, text);

    clearInterval(typingInterval);

    return bot.sendMessage(chatId, reply, keyboard);
  } catch (e) {
    console.error("Ошибка Claude:", e.message);
    return bot.sendMessage(chatId, "Произошла ошибка. Попробуйте позже.", keyboard);
  }
});

console.log("🚀 Real Invest BOT с Claude запущен!");
