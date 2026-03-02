require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

// ===== ПРОВЕРКА ТОКЕНА =====
const TOKEN = process.env.TELEGRAM_TOKEN;

if (!TOKEN) {
  console.error("❌ TELEGRAM_TOKEN не найден");
  process.exit(1);
}

// ===== СОЗДАНИЕ БОТА =====
const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
  },
});

console.log("🚀 Real Invest PRO бот запущен");

// ===== КЛАВИАТУРА =====
const keyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["🏢 Сдать недвижимость", "🔑 Снять недвижимость"],
      ["📞 Связаться"],
    ],
    resize_keyboard: true,
  },
};

// ===== START =====
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Здравствуйте 👋\n\nЯ помощник агентства Real Invest.\nПомогу купить, продать, сдать или снять недвижимость.\n\nВыберите действие:",
    keyboard
  );
});

// ===== ОБРАБОТКА СООБЩЕНИЙ =====
bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    // Игнорируем /start (уже обработан)
    if (text === "/start") return;

    // ===== КУПИТЬ =====
    if (text === "🏠 Купить недвижимость") {
      return bot.sendMessage(
        chatId,
        "Отлично 👍\n\nНапишите:\n• Город\n• Бюджет\n• Количество комнат\n\nНаш менеджер свяжется с вами.",
        keyboard
      );
    }

    // ===== ПРОДАТЬ =====
    if (text === "🏷 Продать недвижимость") {
      return bot.sendMessage(
        chatId,
        "Отправьте:\n• Адрес объекта\n• Фото\n• Желаемую цену\n\nМы поможем продать быстро и выгодно.",
        keyboard
      );
    }

    // ===== СДАТЬ =====
    if (text === "🏢 Сдать недвижимость") {
      return bot.sendMessage(
        chatId,
        "Отправьте:\n• Адрес\n• Фото\n• Цена аренды\n\nПодберем арендатора.",
        keyboard
      );
    }

    // ===== СНЯТЬ =====
    if (text === "🔑 Снять недвижимость") {
      return bot.sendMessage(
        chatId,
        "Напишите:\n• Город\n• Бюджет\n• Срок аренды\n\nПодберем варианты.",
        keyboard
      );
    }

    // ===== СВЯЗАТЬСЯ =====
    if (text === "📞 Связаться") {
      return bot.sendMessage(
        chatId,
        "Связаться с нами:\n📱 +373 777 72 4 73\n\nReal Invest — работаем по всей ПМР 🇲🇩",
        keyboard
      );
    }

    // ===== ПО УМОЛЧАНИЮ =====
    return bot.sendMessage(
      chatId,
      "Пожалуйста, выберите действие из меню 👇",
      keyboard
    );

  } catch (error) {
    console.error("Ошибка:", error);
  }
});
