require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: true,
});

// команды
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(
    chatId,
    `🏠 Добро пожаловать в RealInvest

Продажа недвижимости в Тирасполе и ПМР

📞 Оставьте номер телефона — менеджер свяжется с вами`
  );

  bot.sendMessage(chatId, "👇 Нажмите кнопку:", {
    reply_markup: {
      keyboard: [[{ text: "📱 Отправить номер", request_contact: true }]],
      resize_keyboard: true,
    },
  });
});

// получение номера
bot.on("contact", async (msg) => {
  const phone = msg.contact.phone_number;
  const user = msg.from;

  const text = `
🔥 НОВАЯ ЗАЯВКА

👤 ${user.first_name || ""} ${user.last_name || ""}
📱 ${phone}
🆔 @${user.username || "нет"}
`;

  // отправка в канал
  await bot.sendMessage(process.env.CHANNEL_ID, text);

  bot.sendMessage(msg.chat.id, "✅ Заявка отправлена! Мы скоро свяжемся.");
});

// защита от падений
bot.on("polling_error", console.log);



  

  
