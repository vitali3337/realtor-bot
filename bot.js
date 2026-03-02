require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');

// ===============================
// 🔐 ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ
// ===============================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!TELEGRAM_TOKEN || !ANTHROPIC_KEY) {
  console.error("❌ Не заданы TELEGRAM_TOKEN или ANTHROPIC_API_KEY");
  process.exit(1);
}

// ===============================
// 🤖 TELEGRAM
// ===============================
const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: { timeout: 10 }
  }
});

// Удаляем возможный webhook (фикс 409 conflict)
bot.deleteWebHook();

// ===============================
// 🧠 ANTHROPIC
// ===============================
const client = new Anthropic({
  apiKey: ANTHROPIC_KEY,
});

// ===============================
// 🏠 SYSTEM PROMPT (ПМР)
// ===============================
const SYSTEM_PROMPT = `
Ты — профессиональный консультант агентства недвижимости в Приднестровье (ПМР).

Работаешь по всей территории ПМР, преимущественно Тирасполь и ближайшие населённые пункты.

Валюта сделок:
- Основная валюта — доллары США.
- Расчёты ведутся по официальному курсу ПРБ.

Ипотека:
- Банки: ЭксимБанк, Сбербанк ПМР, Агропромбанк.
- Первоначальный взнос — минимум 30%.
- Максимальный срок — 10 лет.
- Средняя ставка — 10% годовых.
- Используй аннуитетную формулу.

Процесс сделки:
- Заключается договор купли-продажи.
- Регистрируется в регистрационной палате.
- Новый техпаспорт выдается в течение 5 рабочих дней.

Правила:
- Отвечай только на русском языке.
- Не упоминай Россию.
- Не выдумывай конкретные объекты.
- Будь профессиональным и дружелюбным.
`;

// ===============================
// 📊 ИПОТЕЧНЫЙ РАСЧЁТ
// ===============================
function calculateMortgage(price) {
  const downPayment = price * 0.3;
  const loan = price - downPayment;
  const rate = 0.10 / 12;
  const months = 10 * 12;

  const monthly =
    loan *
    (rate * Math.pow(1 + rate, months)) /
    (Math.pow(1 + rate, months) - 1);

  return {
    downPayment: downPayment.toFixed(0),
    loan: loan.toFixed(0),
    monthly: monthly.toFixed(0),
  };
}

// ===============================
// 🎛 КНОПКИ
// ===============================
const keyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Хочу купить квартиру", "🔑 Хочу снять квартиру"],
      ["💰 Рассчитать ипотеку", "📄 Вопрос по документам"],
      ["📞 Записаться на просмотр"]
    ],
    resize_keyboard: true
  }
};

// ===============================
// 🚀 START
// ===============================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Добро пожаловать!\n\nЯ помогу вам с покупкой или арендой недвижимости в Приднестровье.",
    keyboard
  );
});

// ===============================
// 💬 ОБРАБОТКА СООБЩЕНИЙ
// ===============================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/start")) return;

  try {

    // 📊 Если пользователь вводит сумму
    const numberMatch = text.match(/\d+/);
    if (text.includes("ипотек") && numberMatch) {
      const price = parseInt(numberMatch[0]);
      const calc = calculateMortgage(price);

      return bot.sendMessage(
        chatId,
        `📊 Расчёт ипотеки в ПМР:\n\n` +
        `💵 Стоимость: ${price}$\n` +
        `💰 Первый взнос (30%): ${calc.downPayment}$\n` +
        `🏦 Сумма кредита: ${calc.loan}$\n` +
        `📆 Срок: 10 лет\n` +
        `📈 Ставка: 10%\n\n` +
        `💳 Ежемесячный платёж: ~ ${calc.monthly}$`,
        keyboard
      );
    }

    // 🤖 Claude ответ
    const response = await client.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 800,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: text
        }
      ]
    });

    const reply = response.content[0].text;

    bot.sendMessage(chatId, reply, keyboard);

  } catch (error) {
    console.error("❌ Ошибка:", error);
    bot.sendMessage(chatId, "⚠️ Произошла техническая ошибка. Попробуйте позже.");
  }
});

console.log("🚀 Realtor bot запущен");
