require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");

// ===== ПЕРЕМЕННЫЕ =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_ID = "-1003773163201";

if (!TELEGRAM_TOKEN) {
  console.error("❌ TELEGRAM_TOKEN не найден");
  process.exit(1);
}

if (!ANTHROPIC_KEY) {
  console.error("❌ ANTHROPIC_API_KEY не найден");
  process.exit(1);
}

// ===== EXPRESS =====
const app = express();
app.use(express.json());

// ===== TELEGRAM BOT (БЕЗ polling) =====
const bot = new TelegramBot(TELEGRAM_TOKEN);

// ===== WEBHOOK URL =====
const WEBHOOK_URL = `https://${process.env.RAILWAY_STATIC_URL}/bot${TELEGRAM_TOKEN}`;

bot.setWebHook(WEBHOOK_URL);

// ===== ANTHROPIC =====
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ===== СИСТЕМНЫЙ ПРОМПТ =====
const SYSTEM_PROMPT = `
Ты — вежливый помощник агентства недвижимости Real Invest в Приднестровье.

Твои задачи:
- Помогать купить, продать, снять или сдать недвижимость
- Отвечать кратко (до 4 предложений)
- Всегда отвечать на русском языке
- Если клиент готов — попросить номер телефона
`;

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
      ["🏢 Сдать недвижимость", "🔑 Снять недвижимость"],
      ["📄 Документы", "📞 Связаться с менеджером"]
    ],
    resize_keyboard: true
  }
};

// ===== WEBHOOK ОБРАБОТЧИК =====
app.post(`/bot${TELEGRAM_TOKEN}`, async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) {
    res.sendStatus(200);
    return;
  }

  const chatId = msg.chat.id;
  const text = msg.text;

  try {
    // /start
    if (text === "/start") {
      users[chatId] = {};
      conversations[chatId] = [];

      await bot.sendMessage(
        chatId,
        "Здравствуйте 👋\n\nЯ помощник агентства Real Invest.\nПомогу купить, продать, сдать или снять недвижимость.\n\nВыберите действие:",
        keyboard
      );

      res.sendStatus(200);
      return;
    }

    // Кнопки
    if (
      text === "🏠 Купить недвижимость" ||
      text === "🏷 Продать недвижимость" ||
      text === "🏢 Сдать недвижимость" ||
      text === "🔑 Снять недвижимость"
    ) {
      users[chatId] = { type: text };

      await bot.sendMessage(
        chatId,
        "Пожалуйста укажите район, бюджет и количество комнат.\nПосле этого напишите номер телефона.",
        keyboard
      );

      res.sendStatus(200);
      return;
    }

    if (text === "📄 Документы") {
      await bot.sendMessage(
        chatId,
        "Для сделки необходимы:\n• Паспорт\n• Правоустанавливающие документы\n• Техпаспорт\n\nПодробности можно уточнить у менеджера.",
        keyboard
      );

      res.sendStatus(200);
      return;
    }

    if (text === "📞 Связаться с менеджером") {
      await bot.sendMessage(
        chatId,
        "Пожалуйста, напишите ваш номер телефона.",
        keyboard
      );

      res.sendStatus(200);
      return;
    }

    // Телефон
    if (/^\+?\d[\d\s\-]{5,}$/.test(text)) {
      await bot.sendMessage(
        ADMIN_ID,
        `📥 Новая заявка\n\nТип: ${users[chatId]?.type || "Не указан"}\nИмя: ${msg.from.first_name}\nUsername: ${msg.from.username || "нет"}\nТелефон: ${text}`
      );

      await bot.sendMessage(
        chatId,
        "✅ Спасибо! Менеджер свяжется с вами в ближайшее время.",
        keyboard
      );

      res.sendStatus(200);
      return;
    }

    // ===== Claude ответ =====
    addToHistory(chatId, "user", text);

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: getHistory(chatId).map(m => ({
        role: m.role,
        content: [{ type: "text", text: m.content }]
      }))
    });

    const reply = response.content[0]?.text || "Попробуйте ещё раз.";

    addToHistory(chatId, "assistant", reply);

    await bot.sendMessage(chatId, reply, keyboard);

    res.sendStatus(200);

  } catch (error) {
    console.error("Ошибка:", error);
    res.sendStatus(200);
  }
});

// ===== ЗАПУСК СЕРВЕРА =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Real Invest WEBHOOK бот запущен");
});
