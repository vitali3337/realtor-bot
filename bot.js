require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");

const token = process.env.TELEGRAM_TOKEN;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!token) {
  console.error("❌ TELEGRAM_TOKEN не найден");
  process.exit(1);
}

if (!anthropicKey) {
  console.error("❌ ANTHROPIC_API_KEY не найден");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

const anthropic = new Anthropic({
  apiKey: anthropicKey,
});

const keyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["🏢 Сдать недвижимость", "🔑 Снять недвижимость"],
      ["📄 Документы", "📞 Связаться"]
    ],
    resize_keyboard: true,
  },
};

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Здравствуйте 👋\n\nЯ помощник агентства Real Invest.\nПомогу купить, продать, сдать или снять недвижимость.\n\nВыберите действие:",
    keyboard
  );
});

bot.on("message", async (msg) => {
  if (msg.text.startsWith("/")) return;

  const userText = msg.text;

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Ты менеджер агентства недвижимости Real Invest в Приднестровье.
Отвечай кратко, профессионально и по делу.
Если клиент хочет купить — уточни бюджет, район и тип жилья.
Если продать — уточни город, тип объекта и цену.
Не пиши длинные тексты.

Запрос клиента:
${userText}`
        }
      ]
    });

    const reply = response.content[0].text;

    bot.sendMessage(msg.chat.id, reply, keyboard);

  } catch (error) {
    console.error(error);
    bot.sendMessage(msg.chat.id, "Ошибка обработки запроса. Попробуйте ещё раз.");
  }
});
