const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');

// ─── Токены из переменных окружения ─────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!TELEGRAM_TOKEN || !ANTHROPIC_KEY) {
  console.error("❌ Нет TELEGRAM_TOKEN или ANTHROPIC_API_KEY");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ─── Память диалогов ─────────────────────────────────────────────
const userMemory = {};

// ─── Системный промпт ────────────────────────────────────────────
const SYSTEM_PROMPT = `
Ты — вежливый и профессиональный помощник агентства недвижимости.

Ты общаешься с клиентами по вопросам покупки и аренды жилья.

Твои задачи:
1. Помочь подобрать квартиру
2. Рассчитать ипотеку
3. Ответить на вопросы по документам
4. Записать на просмотр
5. Предложить консультацию

Правила:
- Отвечай на русском
- Будь дружелюбным
- Используй эмодзи
- Не выдумывай конкретные адреса
- При юридических вопросах рекомендуй консультацию юриста
`;

// ─── Клавиатура ─────────────────────────────────────────────────
const keyboard = {
  reply_markup: {
    keyboard: [
      ['🏠 Хочу купить квартиру', '🔑 Хочу снять квартиру'],
      ['💰 Рассчитать ипотеку', '❓ Вопрос по документам'],
      ['📞 Записаться на просмотр']
    ],
    resize_keyboard: true
  }
};

// ─── Обработка сообщений ─────────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  console.log("Сообщение:", text);

  try {
    // создаём память если нет
    if (!userMemory[chatId]) {
      userMemory[chatId] = [];
    }

    // добавляем сообщение пользователя
    userMemory[chatId].push({
      role: "user",
      content: text
    });

    // ограничиваем память (последние 10 сообщений)
    userMemory[chatId] = userMemory[chatId].slice(-10);

    const response = await client.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: userMemory[chatId]
    });

    const reply = response.content[0].text;

    // сохраняем ответ в память
    userMemory[chatId].push({
      role: "assistant",
      content: reply
    });

    await bot.sendMessage(chatId, reply, keyboard);

  } catch (error) {
    console.error("❌ Ошибка:", error);

    await bot.sendMessage(
      chatId,
      "😔 Произошла техническая ошибка. Попробуйте позже.",
      keyboard
    );
  }
});

console.log("🤖 Бот запущен...");  
