require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");

// ===== КОНФИГУРАЦИЯ =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const ADMIN_ID       = -1003773163201;

if (!TELEGRAM_TOKEN) { console.error("TELEGRAM_TOKEN не найден"); process.exit(1); }
if (!ANTHROPIC_KEY)  { console.error("ANTHROPIC_API_KEY не найден"); process.exit(1); }

const bot    = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ===== СИСТЕМНЫЙ ПРОМПТ =====
const SYSTEM_PROMPT = `Ты — вежливый помощник агентства недвижимости. Общаешься с клиентами в Telegram.

Твои задачи:
- Помогать клиентам купить, продать, снять или сдать недвижимость
- Отвечать на вопросы о сделках, документах, ипотеке
- Рассчитывать ипотечные платежи если спрашивают
- Собирать контактные данные (телефон) для передачи менеджеру

Правила:
- Отвечай коротко, максимум 3-4 предложения
- Используй эмодзи умеренно
- Если клиент готов к сотрудничеству — попроси номер телефона
- Если вопрос юридический — скажи что менеджер проконсультирует
- Отвечай только на русском языке`;

// ===== ХРАНИЛИЩЕ =====
const users         = {};
const conversations = {};

function getHistory(chatId) {
  if (!conversations[chatId]) conversations[chatId] = [];
  return conversations[chatId];
}

function addToHistory(chatId, role, content) {
  const h = getHistory(chatId);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
}

// ===== КНОПКИ =====
const keyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["🏢 Сдать недвижимость",  "🔑 Снять недвижимость"],
      ["🏦 Рассчитать ипотеку",  "📄 Документы"],
      ["📞 Связаться с менеджером"]
    ],
    resize_keyboard: true
  }
};

// ===== CLAUDE =====
async function askClaude(chatId, userMessage) {
  addToHistory(chatId, "user", userMessage);
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: getHistory(chatId),
  });
  const reply = response.content[0]?.text || "Нет ответа.";
  addToHistory(chatId, "assistant", reply);
  return reply;
}

// ===== ЗАЯВКА В ГРУППУ =====
async function sendLead(msg, phone) {
  const u = users[msg.chat.id] || {};
  try {
    await bot.sendMessage(
      ADMIN_ID,
      `📥 Новая заявка!\n\n` +
      `📌 Тип: ${u.type || "Не указан"}\n` +
      `👤 Имя: ${msg.from.first_name || "—"}\n` +
      `📎 Username: @${msg.from.username || "нет"}\n` +
      `🆔 ID: ${msg.from.id}\n` +
      `📱 Телефон: ${phone}\n` +
      (u.info ? `📝 Детали: ${u.info}` : "")
    );
  } catch (e) {
    console.error("Ошибка отправки в группу:", e.message);
  }
}

// ===== /start =====
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || "";
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];
  bot.sendMessage(
    msg.chat.id,
    `Здравствуйте${name ? ", " + name : ""}!\n\n` +
    `Я помощник агентства недвижимости 🏠\n` +
    `Помогу купить, продать, снять или сдать объект.\n\n` +
    `Выберите действие или задайте любой вопрос:`,
    keyboard
  );
});

// ===== /clear =====
bot.onText(/\/clear/, (msg) => {
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, "Начнём сначала!", keyboard);
});

// ===== ОСНОВНОЙ ОБРАБОТЧИК =====
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text;
  if (!text || text.startsWith("/")) return;

  const quickActions = {
    "🏠 Купить недвижимость":    { type: "ПОКУПКА",   prompt: "Клиент хочет купить недвижимость. Спроси район, бюджет и количество комнат. Коротко и дружелюбно." },
    "🏷 Продать недвижимость":   { type: "ПРОДАЖА",   prompt: "Клиент хочет продать недвижимость. Спроси район, площадь, этаж и желаемую цену. Коротко." },
    "🏢 Сдать недвижимость":     { type: "СДАЧА",     prompt: "Клиент хочет сдать недвижимость. Спроси район, количество комнат и желаемую аренду. Коротко." },
    "🔑 Снять недвижимость":     { type: "АРЕНДА",    prompt: "Клиент хочет снять недвижимость. Спроси район, бюджет в месяц и количество комнат. Коротко." },
    "🏦 Рассчитать ипотеку":     { type: "ИПОТЕКА",   prompt: "Клиент хочет рассчитать ипотеку. Спроси стоимость объекта, первоначальный взнос и срок кредита. Коротко." },
    "📄 Документы":              { type: "ДОКУМЕНТЫ", prompt: "Клиент спрашивает про документы для сделки с недвижимостью. Расскажи кратко что нужно при покупке/продаже." },
    "📞 Связаться с менеджером": { type: "СВЯЗЬ",     prompt: "Клиент хочет связаться с менеджером. Попроси номер телефона вежливо." },
  };

  if (quickActions[text]) {
    const action = quickActions[text];
    users[chatId] = { type: action.type };
    try {
      bot.sendChatAction(chatId, "typing");
      const reply = await askClaude(chatId, action.prompt);
      return bot.sendMessage(chatId, reply, keyboard);
    } catch (e) {
      console.error(e);
      return bot.sendMessage(chatId, "Произошла ошибка. Попробуйте ещё раз.", keyboard);
    }
  }

  // Номер телефона — отправляем заявку
  if (/^\+?\d[\d\s\-]{5,}$/.test(text)) {
    try {
      const history = getHistory(chatId);
      const infoLines = history
        .filter(m => m.role === "user")
        .map(m => m.content)
        .slice(-4)
        .join(" | ");
      if (users[chatId]) users[chatId].info = infoLines;

      await sendLead(msg, text);
      delete users[chatId];
      conversations[chatId] = [];

      return bot.sendMessage(
        chatId,
        "✅ Спасибо! Менеджер свяжется с вами в ближайшее время.\n\nЕсли появятся вопросы — пишите!",
        keyboard
      );
    } catch (e) {
      console.error(e);
      return bot.sendMessage(chatId, "Произошла ошибка. Попробуйте ещё раз.", keyboard);
    }
  }

  // Любой текст — отвечает Claude
  try {
    bot.sendChatAction(chatId, "typing");
    const typingInterval = setInterval(() => bot.sendChatAction(chatId, "typing"), 4000);
    const reply = await askClaude(chatId, text);
    clearInterval(typingInterval);
    return bot.sendMessage(chatId, reply, keyboard);
  } catch (e) {
    console.error("Ошибка Claude:", e.message);
    return bot.sendMessage(chatId, "Произошла ошибка. Попробуйте позже.", keyboard);
  }
});

console.log("Realtor BOT с Claude AI запущен!");
