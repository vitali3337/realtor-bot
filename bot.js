require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");

// ===== КОНФИГУРАЦИЯ =====
const TOKEN = process.env.TELEGRAM_TOKEN;
const AI_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_GROUP = Number(process.env.ADMIN_GROUP) || -1003773163201;
const ADMIN_IDS = (process.env.ADMIN_IDS || "5705817827").split(",").map(s => s.trim());
const DB_FILE = "./db.json";

if (!TOKEN) { console.error("НЕТ TELEGRAM_TOKEN"); process.exit(1); }
if (!AI_KEY) { console.error("НЕТ ANTHROPIC_API_KEY"); process.exit(1); }

console.log("Запуск... ADMIN_GROUP =", ADMIN_GROUP);

const bot = new TelegramBot(TOKEN, { polling: true });
const ai = new Anthropic({ apiKey: AI_KEY });

bot.on("polling_error", e => console.error("polling error:", e.message));

// ===== БАЗА ДАННЫХ =====
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { properties: [], clients: {} }; }
}
function saveDB(d) {
  fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2));
}
function saveClient(id, type) {
  const db = loadDB();
  db.clients[String(id)] = { type, date: new Date().toISOString() };
  saveDB(db);
}
function isAdmin(id) {
  return ADMIN_IDS.includes(String(id));
}

// ===== ИСТОРИЯ CLAUDE =====
const chatHistory = {};
function getHistory(id) {
  if (!chatHistory[id]) chatHistory[id] = [];
  return chatHistory[id];
}
function pushHistory(id, role, content) {
  const h = getHistory(id);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, 2);
}

// ===== ТЕЛЕФОН =====
function getPhone(text) {
  const m = text.replace(/[^\d+]/g, "").match(/\+?\d{7,15}/);
  return m ? m[0] : null;
}

// ===== СОСТОЯНИЯ =====
const userState = {};
const addState = {};

// ===== КЛАВИАТУРЫ =====
const mainKb = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["📋 Смотреть объекты", "🏦 Ипотека"],
      ["📄 Документы", "📞 Менеджер"]
    ],
    resize_keyboard: true
  }
};

const contactKb = {
  reply_markup: {
    keyboard: [
      [{ text: "📱 Отправить мой номер", request_contact: true }],
      ["🔙 Назад"]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  }
};

// ===== CLAUDE AI =====
const SYSTEM = `Ты помощник агентства недвижимости РеалИнвест в Тирасполе, Приднестровье.
Адрес офиса: ул. Восстания 10.
Менеджеры: Сергей (777 26536), Александр (777 72487), Виталий (777 72473).
Правила: отвечай коротко (2-3 предложения), только русский язык.
Всегда предлагай посмотреть каталог объектов или оставить номер телефона.`;

async function askClaude(id, text) {
  pushHistory(id, "user", text);
  const res = await ai.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: SYSTEM,
    messages: getHistory(id)
  });
  const reply = res.content[0].text;
  pushHistory(id, "assistant", reply);
  return reply;
}

// ===== ПОКАЗ ОБЪЕКТА =====
async function showProperty(chatId, prop, idx, total) {
  const lines = [
    prop.title,
    "",
    "Адрес: " + prop.address,
    "Цена: " + prop.price,
    prop.rooms ? "Комнат: " + prop.rooms : "",
    prop.area ? "Площадь: " + prop.area : "",
    prop.floor ? "Этаж: " + prop.floor : "",
    prop.desc ? "\n" + prop.desc : "",
    "",
    "Тел: 777 26536 / 777 72473",
    "ул. Восстания 10"
  ].filter(l => l !== "");

  const caption = lines.join("\n");

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Хочу посмотреть этот объект", callback_data: "want:" + prop.id }],
        [
          { text: idx > 0 ? "Пред" : " ", callback_data: idx > 0 ? "prop:" + (idx - 1) : "noop" },
          { text: (idx + 1) + "/" + total, callback_data: "noop" },
          { text: idx < total - 1 ? "След" : " ", callback_data: idx < total - 1 ? "prop:" + (idx + 1) : "noop" }
        ]
      ]
    }
  };

  try {
    if (prop.photo) {
      await bot.sendPhoto(chatId, prop.photo, { caption, ...kb });
    } else {
      await bot.sendMessage(chatId, caption, kb);
    }
  } catch (e) {
    console.error("showProperty:", e.message);
    try { await bot.sendMessage(chatId, caption, kb); } catch {}
  }
}

// ===== ЗАЯВКА =====
async function sendLead(msg, phone) {
  const u = userState[msg.chat.id] || {};
  const text =
    "НОВАЯ ЗАЯВКА - РеалИнвест\n\n" +
    "Тип: " + (u.type || "Не указан") + "\n" +
    (u.property ? "Объект: " + u.property + "\n" : "") +
    "Имя: " + (msg.from.first_name || "-") + " " + (msg.from.last_name || "") + "\n" +
    "Телефон: " + phone + "\n" +
    "ID: " + msg.from.id;

  console.log("Отправляю заявку в", ADMIN_GROUP, "тел:", phone);

  try {
    await bot.sendMessage(ADMIN_GROUP, text, {
      reply_markup: {
        inline_keyboard: [[
          { text: "Позвонить " + phone, url: "tel:" + phone.replace(/\D/g, "") }
        ]]
      }
    });
    console.log("Заявка отправлена OK");
  } catch (e) {
    console.error("Ошибка заявки:", e.message);
  }
}

async function confirmLead(chatId, msg, phone) {
  await sendLead(msg, phone);
  delete userState[chatId];
  chatHistory[chatId] = [];
  saveClient(chatId, "заявка");
  bot.sendMessage(chatId,
    "Заявка принята! Менеджер свяжется с вами.\n\nул. Восстания 10\n777 26536 / 777 72473",
    mainKb
  );
}

// ===== КОМАНДЫ =====

bot.onText(/\/start/, msg => {
  const id = msg.chat.id;
  userState[id] = {};
  chatHistory[id] = [];
  saveClient(id, "старт");
  const name = msg.from.first_name ? ", " + msg.from.first_name : "";
  bot.sendMessage(id,
    "Здравствуйте" + name + "!\n\n" +
    "Добро пожаловать в РеалИнвест!\n\n" +
    "Продажа недвижимости в Приднестровье\n\n" +
    "ул. Восстания 10, Тирасполь\n" +
    "777 26536 / 777 72473\n\n" +
    "Выберите действие:",
    mainKb
  );
});

bot.onText(/\/clear/, msg => {
  userState[msg.chat.id] = {};
  chatHistory[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, "Начнём сначала!", mainKb);
});

bot.onText(/\/add/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  addState[msg.chat.id] = { step: "photo" };
  bot.sendMessage(msg.chat.id,
    "Добавление объекта\n\nШаг 1/6: Отправь фото объекта\n(или напиши /skip чтобы пропустить)"
  );
});

bot.onText(/\/list/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  if (!db.properties.length) {
    return bot.sendMessage(msg.chat.id, "Объектов нет. Добавь через /add");
  }
  let text = "Список объектов (" + db.properties.length + "):\n\n";
  db.properties.forEach((p, i) => {
    text += (i + 1) + ". " + p.title + " - " + p.price + "\n";
  });
  text += "\nДля удаления: /delete N";
  bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/delete (\d+)/, (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  const i = parseInt(match[1]) - 1;
  if (i < 0 || i >= db.properties.length) {
    return bot.sendMessage(msg.chat.id, "Неверный номер. Смотри /list");
  }
  const rem = db.properties.splice(i, 1)[0];
  saveDB(db);
  bot.sendMessage(msg.chat.id, "Удалено: " + rem.title);
});

bot.onText(/\/broadcast/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  const n = Object.keys(db.clients).length;
  bot.sendMessage(msg.chat.id,
    "Готов разослать последний объект " + n + " клиентам.\n\nПодтвердить: /sendall"
  );
});

bot.onText(/\/sendall/, async msg => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  if (!db.properties.length) return bot.sendMessage(msg.chat.id, "Нет объектов для рассылки");
  const prop = db.properties[db.properties.length - 1];
  const clients = Object.keys(db.clients);
  let sent = 0;
  bot.sendMessage(msg.chat.id, "Рассылаю " + clients.length + " клиентам...");
  for (const cid of clients) {
    try { await showProperty(cid, prop, 0, 1); sent++; } catch {}
    await new Promise(r => setTimeout(r, 600));
  }
  bot.sendMessage(msg.chat.id, "Готово! Отправлено: " + sent + " из " + clients.length);
});

bot.onText(/\/stats/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  bot.sendMessage(msg.chat.id,
    "Статистика РеалИнвест:\n\n" +
    "Клиентов в базе: " + Object.keys(db.clients).length + "\n" +
    "Объектов в каталоге: " + db.properties.length + "\n\n" +
    "ID группы заявок: " + ADMIN_GROUP
  );
});

bot.onText(/\/ping/, async msg => {
  if (!isAdmin(msg.chat.id)) return;
  try {
    await bot.sendMessage(ADMIN_GROUP, "Тест связи с группой. Бот работает!");
    bot.sendMessage(msg.chat.id, "Сообщение в группу отправлено успешно!");
  } catch (e) {
    bot.sendMessage(msg.chat.id, "Ошибка: " + e.message);
  }
});

// ===== КОНТАКТ =====
bot.on("contact", async msg => {
  await confirmLead(msg.chat.id, msg, msg.contact.phone_number);
});

// ===== CALLBACK =====
bot.on("callback_query", async q => {
  const id = q.message.chat.id;
  bot.answerCallbackQuery(q.id).catch(() => {});

  if (q.data === "noop") return;

  if (q.data.startsWith("prop:")) {
    const db = loadDB();
    const idx = parseInt(q.data.split(":")[1]);
    if (!db.properties[idx]) return;
    await bot.deleteMessage(id, q.message.message_id).catch(() => {});
    await showProperty(id, db.properties[idx], idx, db.properties.length);
    return;
  }

  if (q.data.startsWith("want:")) {
    const db = loadDB();
    const prop = db.properties.find(p => p.id === q.data.replace("want:", ""));
    userState[id] = { type: "ПОКУПКА", property: prop ? prop.title : "" };
    bot.sendMessage(id,
      "Нажмите кнопку чтобы отправить номер.\nМенеджер свяжется для просмотра.",
      contactKb
    );
  }
});

// ===== ФОТО =====
bot.on("photo", async msg => {
  const id = msg.chat.id;

  if (!isAdmin(id)) {
    try { await bot.forwardMessage(ADMIN_GROUP, id, msg.message_id); } catch {}
    return bot.sendMessage(id, "Фото получено! Менеджер свяжется.", mainKb);
  }

  const st = addState[id];
  if (!st || st.step !== "photo") return;
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  addState[id] = { ...st, photo: fileId, step: "title" };
  bot.sendMessage(id, "Фото принято!\n\nШаг 2/6: Напиши название объекта\n(например: 3-комн. квартира, Центр)");
});

// ===== ОСНОВНОЙ ОБРАБОТЧИК =====
bot.on("message", async msg => {
  const id = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  // РЕЖИМ ДОБАВЛЕНИЯ ОБЪЕКТА
  if (isAdmin(id) && addState[id]) {
    const st = addState[id];

    if (st.step === "photo" && text === "/skip") {
      addState[id] = { ...st, step: "title" };
      return bot.sendMessage(id, "Шаг 2/6: Название объекта:");
    }
    if (st.step === "title") {
      addState[id] = { ...st, title: text, step: "address" };
      return bot.sendMessage(id, "Шаг 3/6: Адрес объекта:");
    }
    if (st.step === "address") {
      addState[id] = { ...st, address: text, step: "price" };
      return bot.sendMessage(id, "Шаг 4/6: Цена\n(например: 35 000$):");
    }
    if (st.step === "price") {
      addState[id] = { ...st, price: text, step: "details" };
      return bot.sendMessage(id,
        "Шаг 5/6: Детали через запятую\n(например: 3 комнаты, 65 кв.м, 4 этаж)\nили /skip:"
      );
    }
    if (st.step === "details") {
      let rooms = "", area = "", floor = "";
      if (text !== "/skip") {
        text.split(",").map(s => s.trim()).forEach(p => {
          if (/комнат/i.test(p)) rooms = p;
          else if (/кв|м/i.test(p)) area = p;
          else if (/этаж/i.test(p)) floor = p;
        });
      }
      addState[id] = { ...st, rooms, area, floor, step: "desc" };
      return bot.sendMessage(id, "Шаг 6/6: Описание объекта\n(или /skip):");
    }
    if (st.step === "desc") {
      const db = loadDB();
      const prop = {
        id: String(Date.now()),
        photo: st.photo || null,
        title: st.title,
        address: st.address,
        price: st.price,
        rooms: st.rooms || "",
        area: st.area || "",
        floor: st.floor || "",
        desc: text !== "/skip" ? text : "",
        date: new Date().toISOString()
      };
      db.properties.push(prop);
      saveDB(db);
      delete addState[id];
      return bot.sendMessage(id,
        "Объект добавлен!\n\n" +
        prop.title + "\n" +
        prop.address + "\n" +
        prop.price + "\n\n" +
        "Всего в каталоге: " + db.properties.length + "\n\n" +
        "Разослать клиентам? /broadcast"
      );
    }
  }

  // КНОПКИ МЕНЮ
  if (text === "🔙 Назад") {
    return bot.sendMessage(id, "Выберите действие:", mainKb);
  }

  if (text === "📋 Смотреть объекты") {
    saveClient(id, "просмотр");
    const db = loadDB();
    if (!db.properties.length) {
      return bot.sendMessage(id,
        "Каталог пополняется.\nПозвоните: 777 26536 / 777 72473",
        mainKb
      );
    }
    await bot.sendMessage(id, "В каталоге " + db.properties.length + " объектов:", mainKb);
    return showProperty(id, db.properties[0], 0, db.properties.length);
  }

  const MENU = {
    "🏠 Купить недвижимость": {
      type: "ПОКУПКА",
      prompt: "Клиент хочет купить недвижимость в Приднестровье. Спроси какой район и бюджет. Предложи посмотреть каталог."
    },
    "🏷 Продать недвижимость": {
      type: "ПРОДАЖА",
      prompt: "Клиент хочет продать недвижимость. Скажи что бесплатно оценим и быстро найдём покупателя. Попроси оставить номер."
    },
    "🏦 Ипотека": {
      type: "ИПОТЕКА",
      prompt: "Клиент хочет узнать про ипотеку в ПМР. Спроси стоимость объекта, первоначальный взнос и срок. Посчитай примерный платёж."
    },
    "📄 Документы": {
      type: "ДОКУМЕНТЫ",
      prompt: "Клиент спрашивает про документы для купли-продажи недвижимости в ПМР. Объясни кратко что нужно."
    },
    "📞 Менеджер": {
      type: "СВЯЗЬ",
      prompt: "Клиент хочет связаться с менеджером. Назови всех менеджеров по имени с номерами. Попроси оставить свой номер."
    }
  };

  if (MENU[text]) {
    const item = MENU[text];
    userState[id] = { type: item.type };
    saveClient(id, item.type);
    try {
      bot.sendChatAction(id, "typing");
      const reply = await askClaude(id, item.prompt);
      await bot.sendMessage(id, reply, mainKb);
      return bot.sendMessage(id, "Нажмите чтобы отправить номер одним касанием:", contactKb);
    } catch (e) {
      console.error("Claude error:", e.message);
      return bot.sendMessage(id, "Произошла ошибка. Попробуйте позже.", mainKb);
    }
  }

  // НОМЕР ТЕЛЕФОНА В ТЕКСТЕ
  const phone = getPhone(text);
  if (phone && phone.length >= 7) {
    await confirmLead(id, msg, phone);
    return;
  }

  // CLAUDE ОТВЕЧАЕТ
  try {
    bot.sendChatAction(id, "typing");
    const timer = setInterval(() => bot.sendChatAction(id, "typing").catch(() => {}), 4000);
    const reply = await askClaude(id, text);
    clearInterval(timer);
    bot.sendMessage(id, reply, mainKb);
  } catch (e) {
    console.error("Claude error:", e.message);
    bot.sendMessage(id, "Произошла ошибка. Попробуйте позже.", mainKb);
  }
});

// ===== ТЕСТ ПРИ ЗАПУСКЕ =====
setTimeout(() => {
  bot.sendMessage(ADMIN_GROUP, "РеалИнвест бот запущен! Готов принимать заявки.")
    .then(() => console.log("Тест группы: OK"))
    .catch(e => console.error("Тест группы ОШИБКА:", e.message));
}, 3000);

console.log("РеалИнвест БОТ запущен! Группа:", ADMIN_GROUP);
           
