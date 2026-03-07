require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");

const TOKEN = process.env.TELEGRAM_TOKEN;
const AI_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_GROUP = Number(process.env.ADMIN_GROUP) || -1003773163201;
const ADMIN_IDS = (process.env.ADMIN_IDS || "5705817827").split(",").map(s => s.trim());
const DB_FILE = "./db.json";

if (!TOKEN) { console.error("Нет TELEGRAM_TOKEN"); process.exit(1); }
if (!AI_KEY) { console.error("Нет ANTHROPIC_API_KEY"); process.exit(1); }

console.log("ADMIN_GROUP =", ADMIN_GROUP);

const bot = new TelegramBot(TOKEN, { polling: true });
const ai = new Anthropic({ apiKey: AI_KEY });

bot.on("polling_error", e => console.error("polling:", e.message));

// БАЗА ДАННЫХ
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { properties: [], clients: {} }; }
}
function saveDB(d) { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }
function saveClient(id, type) {
  const db = loadDB();
  db.clients[String(id)] = { type, date: new Date().toISOString() };
  saveDB(db);
}
function isAdmin(id) { return ADMIN_IDS.includes(String(id)); }

// ИСТОРИЯ ДИАЛОГА
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

// НОМЕР ТЕЛЕФОНА
function getPhone(text) {
  const m = text.replace(/[^\d+]/g, "").match(/\+?\d{7,15}/);
  return m ? m[0] : null;
}

// СОСТОЯНИЯ
const userState = {};
const addState = {};

// КЛАВИАТУРЫ
const mainKb = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["📋 Смотреть объекты",    "🏦 Ипотека"],
      ["📄 Документы",           "📞 Менеджер"]
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

// CLAUDE AI
const SYSTEM = `Ты помощник агентства недвижимости РеалИнвест в Тирасполе, Приднестровье.
Адрес: ул. Восстания 10. Менеджеры: Сергей (777 26536), Александр (777 72487), Виталий (777 72473).
Отвечай коротко 2-3 предложения. Только русский язык. Предлагай посмотреть каталог или оставить номер.`;

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

// ПОКАЗ ОБЪЕКТА
async function showProperty(chatId, prop, idx, total) {
  const caption =
    "*" + prop.title + "*\n\n" +
    "Адрес: " + prop.address + "\n" +
    "Цена: " + prop.price + "\n" +
    (prop.rooms ? "Комнат: " + prop.rooms + "\n" : "") +
    (prop.area  ? "Площадь: " + prop.area + "\n"  : "") +
    (prop.floor ? "Этаж: " + prop.floor + "\n"    : "") +
    (prop.desc  ? "\n" + prop.desc + "\n"          : "") +
    "\nТел: 777 26536 / 777 72473\nул. Восстания 10";

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Хочу посмотреть", callback_data: "want:" + prop.id }],
        [
          { text: idx > 0         ? "◀ Пред" : " ", callback_data: idx > 0         ? "prop:" + (idx-1) : "noop" },
          { text: (idx+1) + " из " + total,          callback_data: "noop" },
          { text: idx < total - 1 ? "След ▶" : " ", callback_data: idx < total - 1 ? "prop:" + (idx+1) : "noop" }
        ]
      ]
    }
  };

  try {
    if (prop.photo) {
      await bot.sendPhoto(chatId, prop.photo, { caption, parse_mode: "Markdown", ...kb });
    } else {
      await bot.sendMessage(chatId, caption, { parse_mode: "Markdown", ...kb });
    }
  } catch (e) {
    console.error("showProperty error:", e.message);
    await bot.sendMessage(chatId, caption, { parse_mode: "Markdown", ...kb });
  }
}

// ЗАЯВКА В ГРУППУ
async function sendLead(msg, phone) {
  const u = userState[msg.chat.id] || {};
  const text =
    "НОВАЯ ЗАЯВКА - РеалИнвест\n\n" +
    "Тип: " + (u.type || "Покупка") + "\n" +
    (u.property ? "Объект: " + u.property + "\n" : "") +
    "Имя: " + (msg.from.first_name || "-") + " " + (msg.from.last_name || "") + "\n" +
    "Username: @" + (msg.from.username || "нет") + "\n" +
    "ID: " + msg.from.id + "\n" +
    "Телефон: " + phone;

  console.log("Отправляю заявку в группу", ADMIN_GROUP, "телефон:", phone);

  try {
    await bot.sendMessage(ADMIN_GROUP, text, {
      reply_markup: {
        inline_keyboard: [[
          { text: "Позвонить " + phone, url: "tel:" + phone.replace(/\D/g, "") }
        ]]
      }
    });
    console.log("Заявка отправлена успешно!");
  } catch (e) {
    console.error("ОШИБКА отправки заявки:", e.message, "code:", e.code);
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

// КОМАНДЫ
bot.onText(/\/start/, msg => {
  const id = msg.chat.id;
  userState[id] = {};
  chatHistory[id] = [];
  saveClient(id, "старт");
  bot.sendMessage(id,
    "Здравствуйте" + (msg.from.first_name ? ", " + msg.from.first_name : "") + "!\n\n" +
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

bot.onText(/\/ping/, async msg => {
  if (!isAdmin(msg.chat.id)) return;
  console.log("Ping от", msg.chat.id, "отправляю в группу", ADMIN_GROUP);
  try {
    await bot.sendMessage(ADMIN_GROUP, "Тест! Бот работает. ID группы: " + ADMIN_GROUP);
    bot.sendMessage(msg.chat.id, "Сообщение в группу отправлено!");
  } catch (e) {
    bot.sendMessage(msg.chat.id, "Ошибка: " + e.message);
    console.error("ping error:", e);
  }
});

bot.onText(/\/add/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  addState[msg.chat.id] = { step: "photo" };
  bot.sendMessage(msg.chat.id, "Шаг 1/6: Отправь фото объекта (или /skip)");
});

bot.onText(/\/list/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  if (!db.properties.length) return bot.sendMessage(msg.chat.id, "Объектов нет. Добавь через /add");
  let text = "Объекты (" + db.properties.length + "):\n\n";
  db.properties.forEach((p, i) => { text += (i+1) + ". " + p.title + " — " + p.price + "\n"; });
  text += "\n/delete N — удалить";
  bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/delete (\d+)/, (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  const i = parseInt(match[1]) - 1;
  if (i < 0 || i >= db.properties.length) return bot.sendMessage(msg.chat.id, "Неверный номер");
  const rem = db.properties.splice(i, 1)[0];
  saveDB(db);
  bot.sendMessage(msg.chat.id, "Удалено: " + rem.title);
});

bot.onText(/\/broadcast/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  const n = Object.keys(db.clients).length;
  bot.sendMessage(msg.chat.id, "Разослать последний объект " + n + " клиентам?\n/sendall — подтвердить");
});

bot.onText(/\/sendall/, async msg => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  if (!db.properties.length) return bot.sendMessage(msg.chat.id, "Нет объектов");
  const prop = db.properties[db.properties.length - 1];
  const clients = Object.keys(db.clients);
  let sent = 0;
  bot.sendMessage(msg.chat.id, "Рассылаю " + clients.length + " клиентам...");
  for (const id of clients) {
    try { await showProperty(id, prop, 0, 1); sent++; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  bot.sendMessage(msg.chat.id, "Готово! Отправлено: " + sent + "/" + clients.length);
});

bot.onText(/\/stats/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  bot.sendMessage(msg.chat.id,
    "Статистика:\n\nКлиентов: " + Object.keys(db.clients).length +
    "\nОбъектов: " + db.properties.length +
    "\n\nID группы: " + ADMIN_GROUP
  );
});

// КОНТАКТ
bot.on("contact", async msg => {
  await confirmLead(msg.chat.id, msg, msg.contact.phone_number);
});

// CALLBACK
bot.on("callback_query", async q => {
  const id = q.message.chat.id;
  bot.answerCallbackQuery(q.id);
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
      "Нажмите кнопку чтобы отправить номер. Менеджер свяжется для просмотра.",
      contactKb
    );
  }
});

// ФОТО
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
  bot.sendMessage(id, "Фото принято! Шаг 2/6: Название объекта:");
});

// ОСНОВНОЙ ОБРАБОТЧИК
bot.on("message", async msg => {
  const id = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  // ДОБАВЛЕНИЕ ОБЪЕКТА
  if (isAdmin(id) && addState[id]) {
    const st = addState[id];
    if (text === "/skip" && st.step === "photo") {
      addState[id] = { ...st, step: "title" };
      return bot.sendMessage(id, "Шаг 2/6: Название объекта:");
    }
    if (st.step === "title") {
      addState[id] = { ...st, title: text, step: "address" };
      return bot.sendMessage(id, "Шаг 3/6: Адрес:");
    }
    if (st.step === "address") {
      addState[id] = { ...st, address: text, step: "price" };
      return bot.sendMessage(id, "Шаг 4/6: Цена:");
    }
    if (st.step === "price") {
      addState[id] = { ...st, price: text, step: "details" };
      return bot.sendMessage(id, "Шаг 5/6: Детали (комнаты, площадь, этаж) или /skip:");
    }
    if (st.step === "details") {
      let rooms = "", area = "", floor = "";
      if (text !== "/skip") {
        text.split(",").map(s => s.trim()).forEach(p => {
          if (p.match(/комнат/i)) rooms = p;
          else if (p.match(/м|кв/i)) area = p;
          else if (p.match(/этаж/i)) floor = p;
        });
      }
      addState[id] = { ...st, rooms, area, floor, step: "desc" };
      return bot.sendMessage(id, "Шаг 6/6: Описание или /skip:");
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
        "Объект добавлен!\n\n" + prop.title + "\n" + prop.address + "\n" + prop.price +
        "\n\nВсего: " + db.properties.length + "\n\nРазослать? /broadcast"
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
      return bot.sendMessage(id, "Каталог пополняется.\n777 26536 / 777 72473", mainKb);
    }
    await bot.sendMessage(id, "У нас " + db.properties.length + " объектов:", mainKb);
    return showProperty(id, db.properties[0], 0, db.properties.length);
  }

  const MENU = {
    "🏠 Купить недвижимость": { type: "ПОКУПКА",   prompt: "Клиент хочет купить недвижимость. Спроси район и бюджет. Предложи посмотреть каталог." },
    "🏷 Продать недвижимость": { type: "ПРОДАЖА",   prompt: "Клиент хочет продать. Скажи что бесплатно оценим и найдём покупателя. Попроси номер." },
    "🏦 Ипотека":              { type: "ИПОТЕКА",   prompt: "Клиент про ипотеку. Спроси стоимость, взнос и срок. Посчитай платёж." },
    "📄 Документы":            { type: "ДОКУМЕНТЫ", prompt: "Клиент про документы для сделки в ПМР. Объясни кратко." },
    "📞 Менеджер":             { type: "СВЯЗЬ",     prompt: "Клиент хочет менеджера. Дай контакты Сергея, Александра, Виталия. Попроси оставить номер." }
  };

  if (MENU[text]) {
    const item = MENU[text];
    userState[id] = { type: item.type };
    saveClient(id, item.type);
    try {
      bot.sendChatAction(id, "typing");
      const reply = await askClaude(id, item.prompt);
      await bot.sendMessage(id, reply, mainKb);
      return bot.sendMessage(id, "Нажмите чтобы отправить номер:", contactKb);
    } catch {
      return bot.sendMessage(id, "Ошибка. Попробуйте позже.", mainKb);
    }
  }

  // НОМЕР ТЕЛЕФОНА
  const phone = getPhone(text);
  if (phone && phone.length >= 7) {
    await confirmLead(id, msg, phone);
    return;
  }

  // CLAUDE
  try {
    bot.sendChatAction(id, "typing");
    const t = setInterval(() => bot.sendChatAction(id, "typing").catch(() => {}), 4000);
    const reply = await askClaude(id, text);
    clearInterval(t);
    bot.sendMessage(id, reply, mainKb);
  } catch {
    bot.sendMessage(id, "Ошибка. Попробуйте позже.", mainKb);
  }
});

// ТЕСТ ПРИ ЗАПУСКЕ
setTimeout(() => {
  bot.sendMessage(ADMIN_GROUP, "РеалИнвест бот запущен и готов к работе!")
    .then(() => console.log("Тест в группу: OK"))
    .catch(e => console.error("Тест в группу ОШИБКА:", e.message));
}, 3000);

console.log("РеалИнвест БОТ запущен! Группа:", ADMIN_GROUP);
