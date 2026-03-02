require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

if (!TELEGRAM_TOKEN) {
  console.error("❌ TELEGRAM_TOKEN не найден");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true
  }
});

// ===============================
// 💰 ИПОТЕЧНЫЙ РАСЧЁТ
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
    downPayment: Math.round(downPayment),
    loan: Math.round(loan),
    monthly: Math.round(monthly),
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
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// ===============================
// 🚀 START
// ===============================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Добро пожаловать!\nЯ помогу вам с покупкой или арендой недвижимости в ПМР.",
    keyboard
  );
});

// ===============================
// 💬 ОБРАБОТКА
// ===============================
bot.on("message", async (msg) => {
  if (!msg.text) return;

  const text = msg.text.trim();
  const chatId = msg.chat.id;

  // Игнорируем команды
  if (text.startsWith("/")) return;

  try {

    // ===== ПОКУПКА =====
    if (text === "🏠 Хочу купить квартиру") {
      return bot.sendMessage(
        chatId,
        "🏠 Отлично!\n\nНапишите:\n1️⃣ Район\n2️⃣ Бюджет в $\n3️⃣ Количество комнат\n4️⃣ Нужна ли ипотека?",
        keyboard
      );
    }

    // ===== АРЕНДА =====
    if (text === "🔑 Хочу снять квартиру") {
      return bot.sendMessage(
        chatId,
        "🔑 Поможем подобрать аренду.\n\nУкажите:\n1️⃣ Район\n2️⃣ Бюджет в $\n3️⃣ Количество комнат\n4️⃣ Когда нужно заехать?",
        keyboard
      );
    }

    // ===== ДОКУМЕНТЫ =====
    if (text === "📄 Вопрос по документам") {
      return bot.sendMessage(
        chatId,
        "📄 Сделка в ПМР проходит так:\n\n✔️ Договор купли-продажи\n✔️ Регистрация в регистрационной палате\n✔️ Новый техпаспорт выдается в течение 5 рабочих дней",
        keyboard
      );
    }

    // ===== ПРОСМОТР =====
    if (text === "📞 Записаться на просмотр") {
      return bot.sendMessage(
        chatId,
        "📞 Напишите ваш номер телефона — и менеджер свяжется с вами.",
        keyboard
      );
    }

    // ===== ИПОТЕКА КНОПКА =====
    if (text === "💰 Рассчитать ипотеку") {
      return bot.sendMessage(
        chatId,
        "Введите стоимость недвижимости в долларах.\nНапример: 50000",
        keyboard
      );
    }

    // ===== ЕСЛИ ВВЕЛИ ЧИСЛО =====
    if (/^\d+$/.test(text)) {
      const price = parseInt(text);

      if (price >= 10000) {
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
    }

    // ===== ПО УМОЛЧАНИЮ =====
    return bot.sendMessage(
      chatId,
      "Пожалуйста, выберите действие из меню ниже 👇",
      keyboard
    );

  } catch (error) {
    console.error("Ошибка:", error);
    bot.sendMessage(chatId, "⚠ Произошла техническая ошибка. Попробуйте позже.");
  }
});

console.log("🚀 Realtor BOT запущен");
