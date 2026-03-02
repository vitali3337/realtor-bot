require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const ADMIN_ID       = -1003773163201; // группа Заявки РеалИнвест

if (!TELEGRAM_TOKEN) { console.error("TELEGRAM_TOKEN не найден"); process.exit(1); }
if (!ANTHROPIC_KEY)  { console.error("ANTHROPIC_API_KEY не найден"); process.exit(1); }

const bot    = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

const SYSTEM_PROMPT = `Ты — вежливый помощник агентства недвижимости Real Invest (РеалИнвест).

Информация об агентстве:
- Адрес: ул. Восстания 10
- Менеджеры: Сергей (777 26536), Александр (777 72473), Виталий (777 72473)
- Работаем с покупкой, продажей, арендой и сдачей недвижимости

Твои задачи:
- Помогать клиентам купить, продать, снять или сдать недвижимость
- Отвечать на вопросы о сделках, документах, ипотеке
- Рассчитывать ипотечные платежи если спрашивают
- В конце разговора обязательно попросить номер телефона для связи с менеджером

Правила:
- Отвечай коротко и дружелюбно, максимум 3-4 предложения
- Используй эмодзи умеренно
- Всегда предлагай позвонить менеджеру или оставить телефон
- Отвечай только на русском языке`;

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

async function sendLead(msg, phone) {
  const u = users[msg.chat.id] || {};
  const history = getHistory(msg.chat.id);
  const details = history
    .filter(m => m.role === "user")
    .map(m => m.content)
    .slice(-5)
    .join("\n• ");

  try {
    await bot.sendMessage(
      ADMIN_ID,
      `📥 *НОВАЯ ЗАЯВКА — РеалИнвест*\n\n` +
      `📌 Тип: ${u.type || "Не указан"}\n` +
      `👤 Имя: ${msg.from.first_name || "—"} ${msg.from.last_name || ""}\n` +
      `📎 Username: @${msg.from.username || "нет"}\n` +
      `🆔 Telegram ID: ${msg.from.id}\n` +
      `📱 Телефон: ${phone}\n\n` +
      `📝 Детали запроса:\n• ${details}\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `👨‍💼 Менеджеры:\n` +
      `• Сергей: 777 26536\n` +
      `• Александр: 777 72473\n` +
      `• Виталий: 777 72473\n` +
      `📍 ул. Восстания 10`,
      { parse_mode: "Markdown" }
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
    `Здравствуйте${name ? ", " + name : ""}! 👋\n\n` +
    `Добро пожаловать в агентство недвижимости *РеалИнвест* 🏠\n\n` +
    `Мы поможем вам:\n` +
    `🏠 Купить или продать недвижимость\n` +
    `🔑 Снять или сдать жильё\n` +
    `🏦 Рассчитать ипотеку\n\n` +
    `📍 Адрес: ул. Восстания 10\n` +
    `📞 Менеджеры: 777 26536 / 777 72473\n\n` +
    `Выберите действие или задайте любой вопрос 👇`,
    { parse_mode: "Markdown", ...keyboard }
  );
});

bot.onText(/\/clear/, (msg) => {
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, "Начнём сначала! 👋", keyboard);
});

// ===== ОСНОВНОЙ ОБРАБОТЧИК =====
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text;
  if (!text || text.startsWith("/")) return;

  const quickActions = {
    "🏠 Купить недвижимость":    { type: "ПОКУПКА",   prompt: "Клиент хочет купить недвижимость. Спроси район, бюджет и количество комнат. Затем предложи оставить номер телефона." },
    "🏷 Продать недвижимость":   { type: "ПРОДАЖА",   prompt: "Клиент хочет продать недвижимость. Спроси район, площадь, этаж и желаемую цену. Затем предложи оставить номер телефона." },
    "🏢 Сдать недвижимость":     { type: "СДАЧА",     prompt: "Клиент хочет сдать недвижимость. Спроси район, количество комнат и желаемую аренду. Затем предложи оставить номер телефона." },
    "🔑 Снять недвижимость":     { type: "АРЕНДА",    prompt: "Клиент хочет снять недвижимость. Спроси район, бюджет в месяц и количество комнат. Затем предложи оставить номер телефона." },
    "🏦 Рассчитать ипотеку":     { type: "ИПОТЕКА",   prompt: "Клиент хочет рассчитать ипотеку. Спроси стоимость объекта, первоначальный взнос и срок кредита. Посчитай и покажи результат." },
    "📄 Документы":              { type: "ДОКУМЕНТЫ", prompt: "Клиент спрашивает про документы для сделки с недвижимостью. Расскажи кратко что нужно. Предложи проконсультироваться с менеджером." },
    "📞 Связаться с менеджером": { type: "СВЯЗЬ",     prompt: "Клиент хочет связаться с менеджером. Скажи что менеджеры Сергей (777 26536), Александр и Виталий (777 72473) готовы помочь. Попроси оставить номер телефона для обратного звонка." },
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
      await sendLead(msg, text);
      delete users[chatId];
      conversations[chatId] = [];
      return bot.sendMessage(
        chatId,
        `✅ Спасибо! Ваша заявка принята.\n\n` +
        `Наш менеджер свяжется с вами в ближайшее время.\n\n` +
        `📍 Также вы можете приехать к нам:\n*ул. Восстания 10*\n\n` +
        `📞 Или позвонить напрямую:\n` +
        `• Сергей: 777 26536\n` +
        `• Александр: 777 72473\n` +
        `• Виталий: 777 72473`,
        { parse_mode: "Markdown", ...keyboard }
      );
    } catch (e) {
      console.error(e);
      return bot.sendMessage(chatId, "Произошла ошибка. Попробуйте ещё раз.", keyboard);
    }
  }

  // Любой текст — Claude отвечает
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

console.log("РеалИнвест BOT запущен!");
