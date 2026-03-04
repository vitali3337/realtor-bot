require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic   = require("@anthropic-ai/sdk");
const fs          = require("fs");

// ===== КОНФИГУРАЦИЯ =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const ADMIN_ID       = -1003773163201; // группа заявок
const ADMIN_IDS      = (process.env.ADMIN_IDS || "").split(",").map(x => x.trim()); // твои личные ID
const DB_FILE        = "./properties.json";

if (!TELEGRAM_TOKEN) { console.error("TELEGRAM_TOKEN не найден"); process.exit(1); }
if (!ANTHROPIC_KEY)  { console.error("ANTHROPIC_API_KEY не найден"); process.exit(1); }

const bot    = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ===== БАЗА ОБЪЕКТОВ =====
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { properties: [], clients: {} }; }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ===== СИСТЕМНЫЙ ПРОМПТ =====
const SYSTEM_PROMPT = `Ты — вежливый помощник агентства недвижимости Real Invest (РеалИнвест) в Тирасполе.

Информация об агентстве:
- Адрес: ул. Восстания 10, Тирасполь
- Менеджеры: Сергей (777 26536), Александр (777 72473), Виталий (777 72473)
- Занимаемся только продажей недвижимости в Приднестровье

Твои задачи:
- Помогать клиентам купить недвижимость
- Отвечать на вопросы о сделках и документах
- Рассчитывать стоимость если спрашивают
- Предлагать посмотреть каталог объектов
- Собирать номер телефона для менеджера

Правила:
- Отвечай коротко, 2-3 предложения
- Всегда предлагай посмотреть каталог объектов
- Отвечай только на русском языке`;

// ===== ХРАНИЛИЩЕ =====
const users         = {};
const conversations = {};
const adminStates   = {};

function getHistory(chatId) {
  if (!conversations[chatId]) conversations[chatId] = [];
  return conversations[chatId];
}

function addToHistory(chatId, role, content) {
  const h = getHistory(chatId);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
}

function isAdmin(chatId) {
  return ADMIN_IDS.includes(String(chatId));
}

// ===== КНОПКИ =====
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Смотреть объекты",      "🏷 Продать недвижимость"],
      ["🏦 Рассчитать ипотеку",    "📄 Документы"],
      ["📞 Связаться с менеджером","💬 Задать вопрос"]
    ],
    resize_keyboard: true
  }
};

// ===== ПОКАЗАТЬ ОБЪЕКТ =====
async function showProperty(chatId, property, index, total) {
  const caption =
    `🏠 *${property.title}*\n\n` +
    `📍 ${property.address}\n` +
    `💰 Цена: *${property.price}*\n` +
    (property.rooms    ? `🛏 Комнат: ${property.rooms}\n`  : "") +
    (property.area     ? `📐 Площадь: ${property.area}\n`  : "") +
    (property.floor    ? `🏢 Этаж: ${property.floor}\n`    : "") +
    (property.description ? `\n📝 ${property.description}\n` : "") +
    `\n━━━━━━━━━━━━━━━\n` +
    `📞 777 26536 / 777 72473\n` +
    `📍 ул. Восстания 10`;

  const inlineKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📞 Хочу посмотреть этот объект", callback_data: `want_${property.id}` }],
        [
          index > 0
            ? { text: "⬅️ Пред.", callback_data: `prop_${index - 1}` }
            : { text: "⬅️", callback_data: "noop" },
          { text: `${index + 1}/${total}`, callback_data: "noop" },
          index < total - 1
            ? { text: "След. ➡️", callback_data: `prop_${index + 1}` }
            : { text: "➡️", callback_data: "noop" }
        ]
      ]
    }
  };

  try {
    if (property.photo) {
      await bot.sendPhoto(chatId, property.photo, {
        caption,
        parse_mode: "Markdown",
        ...inlineKeyboard
      });
    } else {
      await bot.sendMessage(chatId, caption, {
        parse_mode: "Markdown",
        ...inlineKeyboard
      });
    }
  } catch (e) {
    await bot.sendMessage(chatId, caption, {
      parse_mode: "Markdown",
      ...inlineKeyboard
    });
  }
}

// ===== CLAUDE =====
async function askClaude(chatId, userMessage) {
  addToHistory(chatId, "user", userMessage);
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: getHistory(chatId),
  });
  const reply = response.content[0]?.text || "Нет ответа.";
  addToHistory(chatId, "assistant", reply);
  return reply;
}

// ===== ЗАЯВКА В ГРУППУ =====
async function sendLead(msg, phone, propertyTitle) {
  const u = users[msg.chat.id] || {};
  try {
    await bot.sendMessage(
      ADMIN_ID,
      `📥 *НОВАЯ ЗАЯВКА — РеалИнвест*\n\n` +
      `📌 Тип: ${u.type || "Покупка"}\n` +
      (propertyTitle ? `🏠 Объект: ${propertyTitle}\n` : "") +
      `👤 Имя: ${msg.from.first_name || "—"} ${msg.from.last_name || ""}\n` +
      `📎 Username: @${msg.from.username || "нет"}\n` +
      `🆔 ID: ${msg.from.id}\n` +
      `📱 Телефон: ${phone}\n\n` +
      `👨‍💼 Менеджеры:\n` +
      `• Сергей: 777 26536\n` +
      `• Александр: 777 72473\n` +
      `• Виталий: 777 72473\n` +
      `📍 ул. Восстания 10`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("Ошибка отправки заявки:", e.message);
  }
}

// ===== СОХРАНИТЬ КЛИЕНТА =====
function saveClient(chatId, type) {
  const db = loadDB();
  if (!db.clients[chatId]) {
    db.clients[chatId] = { type, date: new Date().toISOString() };
    saveDB(db);
  }
}

// ===== КОМАНДЫ =====
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || "";
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];
  saveClient(msg.chat.id, "новый");
  bot.sendMessage(
    msg.chat.id,
    `Здравствуйте${name ? ", " + name : ""}! 👋\n\n` +
    `Добро пожаловать в *РеалИнвест* 🏠\n\n` +
    `Мы поможем купить или продать недвижимость в Приднестровье.\n\n` +
    `📍 ул. Восстания 10, Тирасполь\n` +
    `📞 777 26536 / 777 72473\n\n` +
    `👇 Нажмите *"Смотреть объекты"* чтобы увидеть наши предложения!`,
    { parse_mode: "Markdown", ...mainKeyboard }
  );
});

bot.onText(/\/clear/, (msg) => {
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, "Начнём сначала! 👋", mainKeyboard);
});

// ===== ДОБАВИТЬ ОБЪЕКТ (только админ) =====
bot.onText(/\/add/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  adminStates[msg.chat.id] = { step: "photo" };
  bot.sendMessage(msg.chat.id,
    "📸 *Добавление объекта*\n\nШаг 1/6: Отправь фото объекта\n(или напиши /skip чтобы пропустить)",
    { parse_mode: "Markdown" }
  );
});

// ===== СПИСОК ОБЪЕКТОВ (только админ) =====
bot.onText(/\/list/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  if (db.properties.length === 0) {
    return bot.sendMessage(msg.chat.id, "Объектов пока нет. Добавь через /add");
  }
  let text = `📋 *Список объектов (${db.properties.length}):*\n\n`;
  db.properties.forEach((p, i) => {
    text += `${i + 1}. ${p.title} — ${p.price}\n`;
  });
  text += "\nДля удаления: /delete номер (например /delete 3)";
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// ===== УДАЛИТЬ ОБЪЕКТ (только админ) =====
bot.onText(/\/delete (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const db  = loadDB();
  const idx = parseInt(match[1]) - 1;
  if (idx < 0 || idx >= db.properties.length) {
    return bot.sendMessage(msg.chat.id, "Неверный номер объекта");
  }
  const removed = db.properties.splice(idx, 1)[0];
  saveDB(db);
  bot.sendMessage(msg.chat.id, `✅ Объект "${removed.title}" удалён`);
});

// ===== РАССЫЛКА (только админ) =====
bot.onText(/\/broadcast/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  const clients = Object.keys(db.clients);
  bot.sendMessage(msg.chat.id,
    `📣 Разослать последний добавленный объект ${clients.length} клиентам?\n\nНапиши /sendall чтобы подтвердить`
  );
});

bot.onText(/\/sendall/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  if (db.properties.length === 0) return bot.sendMessage(msg.chat.id, "Нет объектов для рассылки");

  const lastProp = db.properties[db.properties.length - 1];
  const clients  = Object.keys(db.clients);
  let sent = 0;

  bot.sendMessage(msg.chat.id, `📣 Начинаю рассылку для ${clients.length} клиентов...`);

  for (const clientId of clients) {
    try {
      await showProperty(clientId, lastProp, 0, 1);
      sent++;
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`Ошибка рассылки для ${clientId}:`, e.message);
    }
  }

  bot.sendMessage(msg.chat.id, `✅ Рассылка завершена! Отправлено: ${sent}/${clients.length}`);
});

// ===== CALLBACK КНОПКИ =====
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data   = query.data;

  if (data === "noop") return bot.answerCallbackQuery(query.id);

  // Листание объектов
  if (data.startsWith("prop_")) {
    const db    = loadDB();
    const index = parseInt(data.split("_")[1]);
    if (db.properties[index]) {
      await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      await showProperty(chatId, db.properties[index], index, db.properties.length);
    }
    return bot.answerCallbackQuery(query.id);
  }

  // Хочу посмотреть объект
  if (data.startsWith("want_")) {
    const db   = loadDB();
    const prop = db.properties.find(p => p.id === data.replace("want_", ""));
    users[chatId] = { type: "ПОКУПКА", property: prop?.title };
    saveClient(chatId, "покупка");
    bot.answerCallbackQuery(query.id);
    return bot.sendMessage(
      chatId,
      `Отлично! 😊\n\nОставьте номер телефона — менеджер свяжется с вами для организации просмотра *${prop?.title || "объекта"}*`,
      { parse_mode: "Markdown", ...mainKeyboard }
    );
  }
});

// ===== ОБРАБОТКА ФОТО ОТ АДМИНА =====
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  const state = adminStates[chatId];
  if (!state || state.step !== "photo") return;

  const fileId = msg.photo[msg.photo.length - 1].file_id;
  adminStates[chatId] = { ...state, photo: fileId, step: "title" };
  bot.sendMessage(chatId, "✅ Фото принято!\n\nШаг 2/6: Введи название\n(например: 2-комнатная квартира, Центр)");
});

// ===== ОСНОВНОЙ ОБРАБОТЧИК =====
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text;
  if (!text || text.startsWith("/")) return;

  // ===== РЕЖИМ ДОБАВЛЕНИЯ ОБЪЕКТА (АДМИН) =====
  if (isAdmin(chatId) && adminStates[chatId]) {
    const state = adminStates[chatId];

    if (text === "/skip" && state.step === "photo") {
      adminStates[chatId] = { ...state, step: "title" };
      return bot.sendMessage(chatId, "Шаг 2/6: Введи название объекта:");
    }

    if (state.step === "title") {
      adminStates[chatId] = { ...state, title: text, step: "address" };
      return bot.sendMessage(chatId, "Шаг 3/6: Введи адрес:");
    }

    if (state.step === "address") {
      adminStates[chatId] = { ...state, address: text, step: "price" };
      return bot.sendMessage(chatId, "Шаг 4/6: Введи цену (например: 35 000$):");
    }

    if (state.step === "price") {
      adminStates[chatId] = { ...state, price: text, step: "details" };
      return bot.sendMessage(chatId,
        "Шаг 5/6: Введи детали через запятую:\n(комнаты, площадь, этаж)\nНапример: 2 комнаты, 54 м², 5/9 этаж\nИли напиши /skip"
      );
    }

    if (state.step === "details") {
      let rooms = "", area = "", floor = "";
      if (text !== "/skip") {
        const parts = text.split(",").map(s => s.trim());
        parts.forEach(p => {
          if (p.includes("комнат")) rooms = p;
          else if (p.includes("м²") || p.includes("м2")) area = p;
          else if (p.includes("этаж")) floor = p;
        });
      }
      adminStates[chatId] = { ...state, rooms, area, floor, step: "description" };
      return bot.sendMessage(chatId, "Шаг 6/6: Добавь описание объекта\n(или напиши /skip):");
    }

    if (state.step === "description") {
      const db = loadDB();
      const newProperty = {
        id:          Date.now().toString(),
        photo:       state.photo || null,
        title:       state.title,
        address:     state.address,
        price:       state.price,
        rooms:       state.rooms || "",
        area:        state.area  || "",
        floor:       state.floor || "",
        description: text !== "/skip" ? text : "",
        date:        new Date().toISOString()
      };

      db.properties.push(newProperty);
      saveDB(db);
      delete adminStates[chatId];

      bot.sendMessage(chatId,
        `✅ *Объект добавлен!*\n\n` +
        `🏠 ${newProperty.title}\n` +
        `📍 ${newProperty.address}\n` +
        `💰 ${newProperty.price}\n\n` +
        `Всего объектов: ${db.properties.length}\n\n` +
        `📣 Разослать клиентам? → /broadcast`,
        { parse_mode: "Markdown" }
      );
      return;
    }
  }

  // ===== КНОПКИ МЕНЮ =====
  if (text === "🏠 Смотреть объекты") {
    const db = loadDB();
    saveClient(chatId, "просмотр");
    if (db.properties.length === 0) {
      return bot.sendMessage(chatId,
        "Сейчас обновляем каталог. Позвоните нам:\n📞 777 26536 / 777 72473",
        mainKeyboard
      );
    }
    await bot.sendMessage(chatId,
      `📋 У нас ${db.properties.length} объектов в продаже. Смотрите 👇`,
      mainKeyboard
    );
    return showProperty(chatId, db.properties[0], 0, db.properties.length);
  }

  const quickActions = {
    "🏷 Продать недвижимость":   { type: "ПРОДАЖА",   prompt: "Клиент хочет продать недвижимость в Приднестровье. Спроси адрес, площадь и желаемую цену. Скажи что оценим бесплатно." },
    "🏦 Рассчитать ипотеку":     { type: "ИПОТЕКА",   prompt: "Клиент хочет рассчитать ипотеку. Спроси стоимость объекта, первоначальный взнос и срок. Посчитай ежемесячный платёж." },
    "📄 Документы":              { type: "ДОКУМЕНТЫ", prompt: "Клиент спрашивает про документы для сделки. Расскажи кратко что нужно при покупке недвижимости в ПМР." },
    "📞 Связаться с менеджером": { type: "СВЯЗЬ",     prompt: "Клиент хочет связаться с менеджером РеалИнвест. Попроси номер телефона для обратного звонка." },
    "💬 Задать вопрос":          { type: "ВОПРОС",    prompt: "Клиент хочет задать вопрос. Спроси чем можешь помочь." },
  };

  if (quickActions[text]) {
    const action = quickActions[text];
    users[chatId] = { type: action.type };
    saveClient(chatId, action.type);
    try {
      bot.sendChatAction(chatId, "typing");
      const reply = await askClaude(chatId, action.prompt);
      return bot.sendMessage(chatId, reply, mainKeyboard);
    } catch (e) {
      return bot.sendMessage(chatId, "Произошла ошибка. Попробуйте ещё раз.", mainKeyboard);
    }
  }

  // Номер телефона
  if (/^\+?\d[\d\s\-]{5,}$/.test(text)) {
    try {
      const u = users[chatId] || {};
      await sendLead(msg, text, u.property);
      delete users[chatId];
      conversations[chatId] = [];
      saveClient(chatId, "заявка");
      return bot.sendMessage(
        chatId,
        `✅ Спасибо! Заявка принята.\n\n` +
        `Менеджер свяжется с вами в ближайшее время.\n\n` +
        `📍 Также приходите к нам:\n*ул. Восстания 10, Тирасполь*\n\n` +
        `📞 777 26536 / 777 72473`,
        { parse_mode: "Markdown", ...mainKeyboard }
      );
    } catch (e) {
      return bot.sendMessage(chatId, "Произошла ошибка. Попробуйте ещё раз.", mainKeyboard);
    }
  }

  // Claude отвечает
  try {
    bot.sendChatAction(chatId, "typing");
    const typingInterval = setInterval(() => bot.sendChatAction(chatId, "typing"), 4000);
    const reply = await askClaude(chatId, text);
    clearInterval(typingInterval);
    return bot.sendMessage(chatId, reply, mainKeyboard);
  } catch (e) {
    return bot.sendMessage(chatId, "Произошла ошибка. Попробуйте позже.", mainKeyboard);
  }
});

console.log("РеалИнвест BOT с каталогом запущен!");
