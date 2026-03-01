const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");

// ───── Проверка переменных окружения ─────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!TELEGRAM_TOKEN || !ANTHROPIC_KEY) {
  console.error("❌ TELEGRAM_TOKEN или ANTHROPIC_API_KEY не заданы");
  process.exit(1);
}

// ───── Инициализация ─────
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ───── Память диалогов ─────
const userMemory = {};

// ───── Системный промпт ─────
const SYSTEM_PROMPT = `
Ты — профессиональный помощник агентства недвижимости.

Помогаешь:
- Подобрать квартиру
- Рассчитать ипотеку
- Ответить по документам
- Записать на просмотр

Правила:
- Отвечай на русском языке
- Будь вежлив
- Используй эмодзи
- Не выдумывай конкретные адреса
- Предлагай оставить номер телефона при готовности к просмотру
`;

// ───── Клавиатура ─────
const keyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Хочу купить квартиру", "🔑 Хочу снять квартиру"],
      ["💰 Рассчитать ипотеку", "❓ Вопрос по документам"],
      ["📞 Записаться на просмотр"]
    ],
    resize_keyboard: true
  }
};

// ───── Обработка сообщений ─────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  console.log("📩 Сообщение:", text);

  try {
    if (!userMemory[chatId]) {
      userMemory[chatId] = [];
    }

    userMemory[chatId].push({
      role: "user",
      content: text
    });

    userMemory[chatId] = userMemory[chatId].slice(-8);

    const response = await client.messages.create({
      model: "claude-3-sonnet-20240229",
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: userMemory[chatId]
    });

    const reply = response.content[0].text;

    userMemory[chatId].push({
      role: "assistant",
      content: reply
    });

    await bot.sendMessage(chatId, reply, keyboard);

  } catch (error) {
    console.error("❌ Ошибка Claude:", JSON.stringify(error, null, 2));

    let errorMessage = "😔 Произошла техническая ошибка. Попробуйте позже.";

    if (error?.status === 400) {
      errorMessage = "⚠️ Ошибка доступа к API. Проверьте баланс в Claude.";
    }

    if (error?.status === 404) {
      errorMessage = "⚠️ Модель недоступна для вашего аккаунта.";
    }

    await bot.sendMessage(chatId, errorMessage, keyboard);
  }
});

console.log("🤖 Бот успешно запущен");
