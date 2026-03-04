{ parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("Ошибка отправки в группу:", e.message);
  }
}

// ===== /start =====
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || "";
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];

  bot.sendMessage(
    msg.chat.id,
    `Здравствуйте${name ? ", " + name : ""}! 👋

Добро пожаловать в агентство недвижимости *РеалИнвест* 🏠

Мы поможем вам:
🏠 Купить или продать недвижимость
🔑 Снять или сдать жильё
🏦 Рассчитать ипотеку

📍 Адрес: ул. Восстания 10
📞 Менеджеры: 777 26536 / 777 72473

Выберите действие или задайте любой вопрос 👇`,
    { parse_mode: "Markdown", ...keyboard }
  );
});

// ===== /clear =====
bot.onText(/\/clear/, (msg) => {
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, "Начнём сначала! 👋", keyboard);
});

// ===== ОСНОВНОЙ ОБРАБОТЧИК =====
bot.on("message", async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  const quickActions = {

    "🏠 Купить недвижимость": {
      type: "ПОКУПКА",
      prompt: "Клиент хочет купить недвижимость. Спроси район, бюджет и количество комнат. Затем предложи оставить номер телефона."
    },

    "🏷 Продать недвижимость": {
      type: "ПРОДАЖА",
      prompt: "Клиент хочет продать недвижимость. Спроси район, площадь, этаж и желаемую цену. Затем предложи оставить номер телефона."
    },

    "🏢 Сдать недвижимость": {
      type: "СДАЧА",
      prompt: "Клиент хочет сдать недвижимость. Спроси район, количество комнат и желаемую аренду. Затем предложи оставить номер телефона."
    },

    "🔑 Снять недвижимость": {
      type: "АРЕНДА",
      prompt: "Клиент хочет снять недвижимость. Спроси район, бюджет в месяц и количество комнат. Затем предложи оставить номер телефона."
    },

    "🏦 Рассчитать ипотеку": {
      type: "ИПОТЕКА",
      prompt: "Клиент хочет рассчитать ипотеку. Спроси стоимость объекта, первоначальный взнос и срок кредита."
    },

    "📄 Документы": {
      type: "ДОКУМЕНТЫ",
      prompt: "Клиент спрашивает про документы для сделки с недвижимостью. Расскажи кратко что нужно."
    },

    "📞 Связаться с менеджером": {
      type: "СВЯЗЬ",
      prompt: "Клиент хочет связаться с менеджером. Скажи что менеджеры Сергей (777 26536), Александр и Виталий (777 72473) готовы помочь. Попроси оставить номер телефона."
    }

  };

  if (quickActions[text]) {

    const action = quickActions[text];
    users[chatId] = { type: action.type };

    try {

      bot.sendChatAction(chatId, "typing");

      const reply = await askClaude(chatId, action.prompt);

      return bot.sendMessage(chatId, reply, keyboard);

    } catch (e) {

      console.error(e);

      return bot.sendMessage(
        chatId,
        "Произошла ошибка. Попробуйте ещё раз.",
        keyboard
      );

    }

  }

  // Номер телефона — отправляем заявку
  if (/^\+?\d[\d\s\-]{5,}$/.test(text)) {

    try {

      await sendLead(msg, text);

      delete users[chatId];
      conversations[chatId] = [];

      return bot.sendMessage(
        chatId,
        `✅ Спасибо! Ваша заявка принята.

Наш менеджер свяжется с вами в ближайшее время.

📍 Также вы можете приехать к нам:
*ул. Восстания 10*

📞 Или позвонить напрямую:
• Сергей: 777 26536
• Александр: 777 72473
• Виталий: 777 72473`,
        { parse_mode: "Markdown", ...keyboard }
      );

    } catch (e) {

      console.error(e);

      return bot.sendMessage(
        chatId,
        "Произошла ошибка. Попробуйте ещё раз.",
        keyboard
      );

    }

  }

  // Любой текст — Claude отвечает
  try {

    bot.sendChatAction(chatId, "typing");

    const typingInterval = setInterval(
      () => bot.sendChatAction(chatId, "typing"),
      4000
    );

    const reply = await askClaude(chatId, text);

    clearInterval(typingInterval);

    return bot.sendMessage(chatId, reply, keyboard);

  } catch (e) {

    console.error("Ошибка Claude:", e.message);

    return bot.sendMessage(
      chatId,
      "Произошла ошибка. Попробуйте позже.",
      keyboard
    );

  }

});

console.log("РеалИнвест BOT запущен!");
