const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');

// ── Конфигурация ──────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!TELEGRAM_TOKEN || !ANTHROPIC_KEY) {
  console.error("❌ Не заданы переменные окружения!");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ── Системный промпт ──────────────────────────────────────────
const SYSTEM_PROMPT = `
Ты — вежливый и профессиональный помощник агентства недвижимости.
Ты общаешься с потенциальными покупателями и арендаторами квартир.

Твои задачи:
1. Подбор жилья
2. Расчёт ипотеки
3. Ответы на вопросы по документам и сделкам
4. Предложение записи на консультацию

Правила:
- Всегда отвечай на русском языке
- Будь дружелюбен
- Используй эмодзи
- Не выдумывай конкретные адреса
- Предлагай оставить номер телефона при готовности к просмотру
`;

// ── Обработчик сообщений ──────────────────────────────────────
bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;
    if (msg.from.is_bot) return;

    const chatId = msg.chat.id;
    const userText = msg.text;

    console.log("📩 Сообщение:", userText);

    // Небольшая задержка (чтобы избежать 429)
    await new Promise(resolve => setTimeout(resolve, 700));

    const response = await client.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 800,
      messages: [
        { role: "user", content: `${SYSTEM_PROMPT}\n\nКлиент: ${userText}` }
      ]
    });

    const reply = response.content[0].text;

    await bot.sendMessage(chatId, reply);

  } catch (error) {
    console.error("❌ Ошибка:", error.message);
    bot.sendMessage(msg.chat.id, "😔 Произошла техническая ошибка. Попробуйте позже.");
  }
});

// ── Обработка ошибок polling ───────────────────────────────────
bot.on("polling_error", (error) => {
  console.log("⚠️ Polling error:", error.message);
});

console.log("🤖 Бот запущен...");
