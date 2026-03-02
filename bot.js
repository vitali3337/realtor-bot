require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

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

const keyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Хочу купить квартиру", "🔑 Хочу снять квартиру"],
      ["💰 Рассчитать ипотеку"]
    ],
    resize_keyboard: true
  }
};

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Бот работает ✅", keyboard);
});

bot.on("message", (msg) => {
  const text = msg.text;
  const chatId = msg.chat.id;

  if (!text || text.startsWith("/start")) return;

  if (text.includes("50000")) {
    const calc = calculateMortgage(50000);
    return bot.sendMessage(chatId,
      `Платёж: ${calc.monthly}$`,
      keyboard
    );
  }

  if (text === "🏠 Хочу купить квартиру") {
    return bot.sendMessage(chatId, "Напишите бюджет в $", keyboard);
  }

  if (text === "🔑 Хочу снять квартиру") {
    return bot.sendMessage(chatId, "Напишите район и бюджет", keyboard);
  }

  bot.sendMessage(chatId, "Работаю ✅", keyboard);
});

console.log("🚀 BOT STARTED");
