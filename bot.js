const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");

// ===== ENV VARIABLES =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!TELEGRAM_TOKEN || !ANTHROPIC_API_KEY) {
  console.error("❌ TELEGRAM_TOKEN или ANTHROPIC_API_KEY отсутствует");
  process.exit(1);
}

// ===== INIT =====
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

// ===== SYSTEM PROMPT =====
const SYSTEM_PROMPT = `
Ты — профессиональный помощник агентства недвижимости.

Твои задачи:
1. Подбор квартиры
2. Помощь с арендой
3. Расчёт ипотеки
4. Ответы по документам
5. Запись на просмотр

Правила:
- Отвечай на русском языке
- Будь вежливым
- Используй эмодзи
- Не выдумывай конкретные объекты
- Если клиент готов — предложи оставить номер телефона
`;

const sessions = {};

// ===== START COMMAND =====
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  sessions[chatId] = [];

  bot.sendMessage(
    chatId,
    "👋 Добро пожаловать!\n\nЯ помогу вам с покупкой или арендой недвижимости.\n\nВыберите действие:",
    {
      reply_markup: {
        keyboard: [
          ["🏠 Хочу купить квартиру", "🔑 Хочу снять квартиру"],
          ["💰 Рассчитать ипотеку", "📄 Вопрос по документам"],
          ["📞 Записаться на просмотр"]
        ],
        resize_keyboard: true
      }
    }
  );
});

// ===== MESSAGE HANDLER =====
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  if (!sessions[chatId]) sessions[chatId] = [];

  sessions[chatId].push({
    role: "user",
    content: text
  });

  try {
    bot.sendChatAction(chatId, "typing");

    const response = await anthropic.messages.create({
      model: "claude-3-sonnet-20240229",
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: sessions[chatId]
    });

    const reply = response.content[0].text;

    sessions[chatId].push({
      role: "assistant",
      content: reply
    });

    await bot.sendMessage(chatId, reply);

  } catch (error) {
    console.error("❌ Ошибка Claude:", error);

    await bot.sendMessage(
      chatId,
      "⚠️ Произошла техническая ошибка. Попробуйте позже."
    );
  }
});

console.log("🚀 Realtor bot запущен");
