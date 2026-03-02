bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/start")) return;

  try {

    // ===== КНОПКИ БЕЗ CLAUDE =====

    if (text === "🏠 Хочу купить квартиру") {
      return bot.sendMessage(chatId,
        "🏠 Отлично!\n\n" +
        "Напишите:\n" +
        "1️⃣ Район\n" +
        "2️⃣ Бюджет в $\n" +
        "3️⃣ Количество комнат\n" +
        "4️⃣ Нужна ли ипотека?",
        keyboard
      );
    }

    if (text === "🔑 Хочу снять квартиру") {
      return bot.sendMessage(chatId,
        "🔑 Поможем подобрать аренду.\n\n" +
        "Укажите:\n" +
        "1️⃣ Район\n" +
        "2️⃣ Бюджет в $\n" +
        "3️⃣ Количество комнат\n" +
        "4️⃣ Когда нужно заехать?",
        keyboard
      );
    }

    if (text === "📄 Вопрос по документам") {
      return bot.sendMessage(chatId,
        "📄 В ПМР сделка проходит так:\n\n" +
        "✔️ Подписывается договор купли-продажи\n" +
        "✔️ Регистрация в регистрационной палате\n" +
        "✔️ Новый техпаспорт — в течение 5 рабочих дней",
        keyboard
      );
    }

    if (text === "📞 Записаться на просмотр") {
      return bot.sendMessage(chatId,
        "📞 Напишите ваш номер телефона — и менеджер свяжется с вами.",
        keyboard
      );
    }

    // ===== ИПОТЕКА =====

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

    // ===== CLAUDE ДЛЯ СВОБОДНЫХ ВОПРОСОВ =====

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 600,
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
    console.error("❌ Ошибка:", error.message);
    bot.sendMessage(chatId, "⚠️ Временная техническая ошибка. Попробуйте позже.");
  }
});
