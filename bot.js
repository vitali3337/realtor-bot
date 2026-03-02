require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = -1003773163201; // группа заявок

if (!TELEGRAM_TOKEN) {
  console.error("❌ TELEGRAM_TOKEN не найден");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ===== ХРАНЕНИЕ СОСТОЯНИЯ =====
const users = {};

// ===============================
// 🎛 КНОПКИ
// ===============================
const keyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["🏢 Сдать недвижимость", "🔑 Снять недвижимость"],
      ["📄 Документы", "📞 Связаться"]
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
    "👋 Добро пожаловать!\nВыберите действие 👇",
    keyboard
  );
});

// ===============================
// 💬 ОБРАБОТКА
// ===============================
bot.on("message", async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;
  if (text.startsWith("/")) return;

  try {

    // ===== ВЫБОР ДЕЙСТВИЯ =====
    if (text === "🏠 Купить недвижимость") {
      users[chatId] = { type: "ПОКУПКА" };
      return bot.sendMessage(chatId,
        "🏠 Укажите:\n📍 Район\n💵 Бюджет\n🛏 Количество комнат\n\nПосле этого напишите номер телефона.",
        keyboard
      );
    }

    if (text === "🏷 Продать недвижимость") {
      users[chatId] = { type: "ПРОДАЖА" };
      return bot.sendMessage(chatId,
        "🏷 Укажите:\n📍 Район\n📐 Площадь\n🏢 Этаж\n💰 Желаемую цену\n\nПосле этого напишите номер телефона.",
        keyboard
      );
    }

    if (text === "🏢 Сдать недвижимость") {
      users[chatId] = { type: "СДАЧА" };
      return bot.sendMessage(chatId,
        "🏢 Укажите:\n📍 Район\n🛏 Комнат\n💵 Желаемую аренду\n\nПосле этого напишите номер телефона.",
        keyboard
      );
    }

    if (text === "🔑 Снять недвижимость") {
      users[chatId] = { type: "АРЕНДА" };
      return bot.sendMessage(chatId,
        "🔑 Укажите:\n📍 Район\n💵 Бюджет\n🛏 Количество комнат\n\nПосле этого напишите номер телефона.",
        keyboard
      );
    }

    if (text === "📄 Документы") {
      return bot.sendMessage(
        chatId,
        "📄 Сделка проходит так:\n\n✔️ Договор купли-продажи\n✔️ Регистрация в палате\n✔️ Новый техпаспорт — 5 рабочих дней",
        keyboard
      );
    }

    if (text === "📞 Связаться") {
      users[chatId] = { type: "СВЯЗЬ" };
      return bot.sendMessage(
        chatId,
        "📞 Напишите номер телефона — и менеджер свяжется с вами.",
        keyboard
      );
    }

    // ===== ЕСЛИ ВВЕДЕН НОМЕР =====
    if (/^\+?\d[\d\s]{5,}$/.test(text)) {

      const userType = users[chatId]?.type || "НЕ УКАЗАНО";

      await bot.sendMessage(
        ADMIN_ID,
        `📥 Новая заявка!\n\n` +
        `📌 Тип: ${userType}\n` +
        `👤 Имя: ${msg.from.first_name}\n` +
        `📎 Username: @${msg.from.username || "нет"}\n` +
        `🆔 Telegram ID: ${msg.from.id}\n` +
        `📱 Телефон: ${text}`
      );

      delete users[chatId];

      return bot.sendMessage(
        chatId,
        "✅ Спасибо! Менеджер свяжется с вами в ближайшее время.",
        keyboard
      );
    }

    return bot.sendMessage(
      chatId,
      "Пожалуйста, выберите действие из меню 👇",
      keyboard
    );

  } catch (error) {
    console.error("Ошибка:", error);
    return bot.sendMessage(
      chatId,
      "⚠ Произошла техническая ошибка. Попробуйте позже.",
      keyboard
    );
  }

});

console.log("🚀 Realtor BOT запущен");
