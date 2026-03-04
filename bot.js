require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const ADMIN_CHAT_ID = -1003773163201;

if (!TELEGRAM_TOKEN) {
  console.error("❌ TELEGRAM_TOKEN не найден");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_KEY
});

console.log("РеалИнвест BOT запущен!");

// память пользователей
const users = {};
const conversations = {};

const keyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["🏢 Сдать недвижимость", "🔑 Снять недвижимость"],
      ["🏦 Рассчитать ипотеку", "📄 Документы"],
      ["📞 Связаться с менеджером"]
    ],
    resize_keyboard: true
  }
};

// ===== Claude =====
async function askClaude(chatId, prompt) {

  if (!conversations[chatId]) {
    conversations[chatId] = [];
  }

  conversations[chatId].push({
    role: "user",
    content: prompt
  });

  const response = await anthropic.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 300,
    messages: conversations[chatId]
  });

  const reply = response.content[0].text;

  conversations[chatId].push({
    role: "assistant",
    content: reply
  });

  return reply;
}

// ===== отправка заявки =====
async function sendLead(msg, phone) {

  const name = msg.from.first_name || "Без имени";
  const username = msg.from.username ? "@" + msg.from.username : "нет";
  const userId = msg.from.id;

  const text =
`📥 *НОВАЯ ЗАЯВКА — РеалИнвест*

👤 Имя: ${name}
📎 Username: ${username}
🆔 Telegram ID: ${userId}
📱 Телефон: ${phone}

📍 Адрес офиса:
ул. Восстания 10`;

  try {

    await bot.sendMessage(
      ADMIN_CHAT_ID,
      text,
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
    `Здравствуйте${name ? ", " + name : ""}! 👋

Добро пожаловать в агентство недвижимости *РеалИнвест* 🏠

Мы поможем вам:

🏠 Купить или продать недвижимость
🔑 Снять или сдать жильё
🏦 Рассчитать ипотеку

📍 Адрес: ул. Восстания 10
📞 Менеджеры:
• Сергей — 777 26536
• Александр — 777 72473
• Виталий — 777 72473

Выберите действие или задайте вопрос 👇`,
    { parse_mode: "Markdown", ...keyboard }
  );

});

// ===== /clear =====
bot.onText(/\/clear/, (msg) => {

  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];

  bot.sendMessage(msg.chat.id, "Начнём сначала 👋", keyboard);

});

// ===== ОСНОВНОЙ ОБРАБОТЧИК =====
bot.on("message", async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  const quickActions = {

    "🏠 Купить недвижимость": {
      type: "ПОКУПКА",
      prompt: "Клиент хочет купить недвижимость. Спроси район, бюджет и количество комнат. Затем предложи оставить номер телефона."
    },

    "🏷 Продать недвижимость": {
      type: "ПРОДАЖА",
      prompt: "Клиент хочет продать недвижимость. Спроси район, площадь и желаемую цену. Затем предложи оставить номер телефона."
    },

    "🏢 Сдать недвижимость": {
      type: "СДАЧА",
      prompt: "Клиент хочет сдать недвижимость. Спроси район, количество комнат и цену аренды."
    },

    "🔑 Снять недвижимость": {
      type: "АРЕНДА",
      prompt: "Клиент хочет снять недвижимость. Спроси район, бюджет в месяц и количество комнат."
    },

    "🏦 Рассчитать ипотеку": {
      type: "ИПОТЕКА",
      prompt: "Клиент хочет рассчитать ипотеку. Спроси стоимость объекта, первый взнос и срок кредита."
    },

    "📄 Документы": {
      type: "ДОКУМЕНТЫ",
      prompt: "Клиент спрашивает какие документы нужны для сделки недвижимости. Объясни кратко."
    },

    "📞 Связаться с менеджером": {
      type: "СВЯЗЬ",
      prompt: "Клиент хочет связаться с менеджером. Попроси оставить номер телефона."
    }

  };

  // быстрые кнопки
  if (quickActions[text]) {

    const action = quickActions[text];
    users[chatId] = { type: action.type };

    try {

      bot.sendChatAction(chatId, "typing");

      const reply = await askClaude(chatId, action.prompt);

      return bot.sendMessage(chatId, reply, keyboard);

    } catch (e) {

      console.error(e);

      return bot.sendMessage(
        chatId,
        "Произошла ошибка. Попробуйте ещё раз.",
        keyboard
      );

    }

  }

  // проверка номера телефона
  if (/^\+?\d[\d\s\-]{5,}$/.test(text)) {

    try {

      await sendLead(msg, text);

      delete users[chatId];
      conversations[chatId] = [];

      return bot.sendMessage(
        chatId,
        `✅ Спасибо! Ваша заявка принята.

Наш менеджер свяжется с вами в ближайшее время.

📍 Адрес офиса:
ул. Восстания 10

📞 Менеджеры:
• Сергей: 777 26536
• Александр: 777 72473
• Виталий: 777 72473`,
        keyboard
      );

    } catch (e) {

      console.error(e);

      return bot.sendMessage(
        chatId,
        "Произошла ошибка. Попробуйте ещё раз.",
        keyboard
      );

    }

  }

  // любой текст — Claude
  try {

    bot.sendChatAction(chatId, "typing");

    const reply = await askClaude(chatId, text);

    return bot.sendMessage(chatId, reply, keyboard);

  } catch (e) {

    console.error("Ошибка Claude:", e.message);

    return bot.sendMessage(
      chatId,
      "Произошла ошибка. Попробуйте позже."
    );

  }

});
