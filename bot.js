require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic   = require("@anthropic-ai/sdk");
const fs          = require("fs");
const axios       = require("axios");
const cheerio     = require("cheerio");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const ADMIN_ID       = -1003773163201;
const ADMIN_IDS      = (process.env.ADMIN_IDS || "5705817827").split(",").map(x => x.trim());
const DB_FILE        = "./properties.json";
const SEEN_FILE      = "./seen_ads.json";
const CHECK_INTERVAL = 5 * 60 * 1000; // каждые 5 минут

if (!TELEGRAM_TOKEN) { console.error("TELEGRAM_TOKEN не найден"); process.exit(1); }
if (!ANTHROPIC_KEY)  { console.error("ANTHROPIC_API_KEY не найден"); process.exit(1); }

const bot    = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ===== БД =====
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { properties: [], clients: {} }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

function loadSeen() {
  try { return JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")); }
  catch { return {}; }
}
function saveSeen(seen) { fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2)); }

function isAdmin(id) { return ADMIN_IDS.includes(String(id)); }
function getHistory(chatId) {
  if (!conversations[chatId]) conversations[chatId] = [];
  return conversations[chatId];
}
function addToHistory(chatId, role, content) {
  const h = getHistory(chatId);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
}
function saveClient(chatId, type) {
  const db = loadDB();
  if (!db.clients) db.clients = {};
  db.clients[chatId] = { type, date: new Date().toISOString() };
  saveDB(db);
}
function extractPhone(text) {
  const digits = text.replace(/[^\d+]/g, "");
  const match  = digits.match(/\+?[\d]{7,15}/);
  return match ? match[0] : null;
}

const users         = {};
const conversations = {};
const adminStates   = {};

const SYSTEM_PROMPT = `Ты — вежливый помощник агентства недвижимости Real Invest (РеалИнвест) в Тирасполе.
Адрес: ул. Восстания 10. Менеджеры: Сергей (777 26536), Александр (777 72487), Виталий (777 72473).
Занимаемся продажей недвижимости в Приднестровье.
Отвечай коротко, 2-3 предложения. Когда клиент готов — скажи нажать кнопку "Отправить мой номер". Только русский язык.`;

// ===== КНОПКИ =====
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["🏢 Сдать недвижимость",  "🔑 Снять недвижимость"],
      ["📋 Смотреть объекты",    "🏦 Рассчитать ипотеку"],
      ["📄 Документы",           "📞 Связаться с менеджером"]
    ],
    resize_keyboard: true
  }
};

const contactKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "📱 Отправить мой номер", request_contact: true }],
      ["🔙 Назад"]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  }
};

// ===== MAKLER ПАРСЕР =====
const MAKLER_URLS = [
  "https://makler.md/tiraspol/real-estate/real-estate-for-sale/apartments-for-sale/",
  "https://makler.md/tiraspol/real-estate/real-estate-for-sale/houses-for-sale/",
  "https://makler.md/bender/real-estate/real-estate-for-sale/apartments-for-sale/",
  "https://makler.md/bender/real-estate/real-estate-for-sale/houses-for-sale/",
  "https://makler.md/ribnitsa/real-estate/real-estate-for-sale/apartments-for-sale/",
];

async function parseMakler() {
  const ads = [];
  for (const url of MAKLER_URLS) {
    try {
      const { data } = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 15000
      });
      const $ = cheerio.load(data);
      $("a[href*='/real-estate/']").each((i, el) => {
        const href  = $(el).attr("href") || "";
        const title = $(el).text().trim();
        if (href && href.includes("/an/") && title.length > 5) {
          const fullLink = href.startsWith("http") ? href : "https://makler.md" + href;
          const price = $(el).closest("div, li, article").find("[class*='price'], .price").first().text().trim();
          const phone = $(el).closest("div, li, article").find("[class*='phone'], .phone").first().text().trim();
          ads.push({
            id: fullLink,
            title: title.substring(0, 100),
            price: price || "Цена не указана",
            phone: phone || "Смотри на сайте",
            link: fullLink,
            city: url.includes("tiraspol") ? "Тирасполь" :
                  url.includes("bender")   ? "Бендеры"   : "Рыбница"
          });
        }
      });
    } catch (e) {
      console.error(`Ошибка парсинга: ${e.message}`);
    }
  }
  return ads;
}

async function checkNewAds() {
  console.log(`[${new Date().toLocaleTimeString()}] Проверяю Makler...`);
  const seen = loadSeen();
  const ads  = await parseMakler();
  let newCount = 0;

  for (const ad of ads) {
    if (!seen[ad.id]) {
      seen[ad.id] = true;
      if (Object.keys(seen).length > ads.length + 5) {
        newCount++;
        try {
          await bot.sendMessage(ADMIN_ID,
            `🔥 *Новый объект на Makler!*\n\n` +
            `📍 Город: ${ad.city}\n` +
            `🏠 ${ad.title}\n` +
            `💰 ${ad.price}\n` +
            `📱 Телефон: ${ad.phone}\n\n` +
            `🔗 [Смотреть объявление](${ad.link})\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `💼 Позвони первым и предложи услуги РеалИнвест!`,
            { parse_mode: "Markdown", disable_web_page_preview: false }
          );
          await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
          console.error("Ошибка отправки:", e.message);
        }
      }
    }
  }

  saveSeen(seen);
  if (newCount > 0) console.log(`Новых объявлений: ${newCount}`);
}

async function initMaklerMonitor() {
  const seen = loadSeen();
  if (Object.keys(seen).length === 0) {
    console.log("Собираю базу Makler...");
    const ads = await parseMakler();
    for (const ad of ads) seen[ad.id] = true;
    saveSeen(seen);
    console.log(`База собрана: ${ads.length} объявлений`);
    try {
      await bot.sendMessage(ADMIN_ID,
        `✅ *Мониторинг Makler запущен!*\n\n` +
        `📊 Запомнил ${ads.length} существующих объявлений\n` +
        `⏰ Проверяю каждые 5 минут\n\n` +
        `📍 Слежу за:\n` +
        `• Тирасполь — квартиры и дома\n` +
        `• Бендеры — квартиры и дома\n` +
        `• Рыбница — квартиры\n\n` +
        `🔔 При новых объявлениях сразу пришлю сюда!`,
        { parse_mode: "Markdown" }
      );
    } catch {}
  } else {
    console.log(`База Makler загружена: ${Object.keys(seen).length} объявлений`);
  }
}

// ===== ПОКАЗАТЬ ОБЪЕКТ =====
async function showProperty(chatId, property, index, total) {
  const caption =
    `🏠 *${property.title}*\n\n` +
    `📍 ${property.address}\n` +
    `💰 Цена: *${property.price}*\n` +
    (property.rooms       ? `🛏 Комнат: ${property.rooms}\n`  : "") +
    (property.area        ? `📐 Площадь: ${property.area}\n`  : "") +
    (property.floor       ? `🏢 Этаж: ${property.floor}\n`    : "") +
    (property.description ? `\n📝 ${property.description}\n`  : "") +
    `\n━━━━━━━━━━━━━━━\n` +
    `📞 777 26536 / 777 72473\n📍 ул. Восстания 10`;

  const nav = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📱 Хочу посмотреть — оставить номер", callback_data: `want_${property.id}` }],
        [
          { text: index > 0 ? "⬅️" : " ", callback_data: index > 0 ? `prop_${index-1}` : "noop" },
          { text: `${index+1}/${total}`, callback_data: "noop" },
          { text: index < total-1 ? "➡️" : " ", callback_data: index < total-1 ? `prop_${index+1}` : "noop" }
        ]
      ]
    }
  };

  try {
    if (property.photo) {
      await bot.sendPhoto(chatId, property.photo, { caption, parse_mode: "Markdown", ...nav });
    } else {
      await bot.sendMessage(chatId, caption, { parse_mode: "Markdown", ...nav });
    }
  } catch {
    await bot.sendMessage(chatId, caption, { parse_mode: "Markdown", ...nav });
  }
}

async function askClaude(chatId, userMessage) {
  addToHistory(chatId, "user", userMessage);
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: getHistory(chatId),
  });
  const reply = response.content[0]?.text || "Нет ответа.";
  addToHistory(chatId, "assistant", reply);
  return reply;
}

async function sendLead(msg, phone, propertyTitle) {
  const u = users[msg.chat.id] || {};
  try {
    await bot.sendMessage(ADMIN_ID,
      `📥 *НОВАЯ ЗАЯВКА — РеалИнвест*\n\n` +
      `📌 Тип: ${u.type || "Покупка"}\n` +
      (propertyTitle ? `🏠 Объект: ${propertyTitle}\n` : "") +
      `👤 Имя: ${msg.from.first_name || "—"} ${msg.from.last_name || ""}\n` +
      `📎 Username: @${msg.from.username || "нет"}\n` +
      `🆔 ID: ${msg.from.id}\n` +
      `📱 Телефон: ${phone}\n\n` +
      `👨‍💼 Менеджеры:\n• Сергей: 777 26536\n• Александр: 777 72487\n• Виталий: 777 72473\n` +
      `📍 ул. Восстания 10`,
      { parse_mode: "Markdown" }
    );
  } catch (e) { console.error("Ошибка заявки:", e.message); }
}

async function confirmLead(chatId, msg, phone, propertyTitle) {
  await sendLead(msg, phone, propertyTitle);
  delete users[chatId];
  conversations[chatId] = [];
  saveClient(chatId, "заявка");
  await bot.sendMessage(chatId,
    `✅ *Спасибо! Заявка принята.*\n\nМенеджер свяжется с вами в ближайшее время.\n\n📍 ул. Восстания 10, Тирасполь\n📞 777 26536 / 777 72473`,
    { parse_mode: "Markdown", ...mainKeyboard }
  );
}

// ===== КОМАНДЫ =====
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || "";
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];
  saveClient(msg.chat.id, "новый");
  bot.sendMessage(msg.chat.id,
    `Здравствуйте${name ? ", " + name : ""}! 👋\n\n` +
    `Добро пожаловать в *РеалИнвест* 🏠\n\n` +
    `Продажа недвижимости в Приднестровье.\n\n` +
    `📍 ул. Восстания 10, Тирасполь\n` +
    `📞 777 26536 / 777 72473\n\n` +
    `Выберите действие 👇`,
    { parse_mode: "Markdown", ...mainKeyboard }
  );
});

bot.onText(/\/clear/, (msg) => {
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, "Начнём сначала! 👋", mainKeyboard);
});

bot.onText(/\/add/, (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  adminStates[msg.chat.id] = { step: "photo" };
  bot.sendMessage(msg.chat.id, "📸 *Добавление объекта*\n\nШаг 1/6: Отправь фото\n(или /skip)", { parse_mode: "Markdown" });
});

bot.onText(/\/list/, (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  if (!db.properties.length) return bot.sendMessage(msg.chat.id, "Объектов нет. Добавь через /add");
  let text = `📋 *Объекты (${db.properties.length}):*\n\n`;
  db.properties.forEach((p, i) => { text += `${i+1}. ${p.title} — ${p.price}\n`; });
  text += "\nУдалить: /delete номер";
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/delete (.+)/, (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const db  = loadDB();
  const idx = parseInt(match[1]) - 1;
  if (idx < 0 || idx >= db.properties.length) return bot.sendMessage(msg.chat.id, "Неверный номер");
  const removed = db.properties.splice(idx, 1)[0];
  saveDB(db);
  bot.sendMessage(msg.chat.id, `✅ "${removed.title}" удалён`);
});

bot.onText(/\/broadcast/, (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  const db    = loadDB();
  const count = Object.keys(db.clients || {}).length;
  bot.sendMessage(msg.chat.id, `📣 Разослать последний объект ${count} клиентам?\nНапиши /sendall`);
});

bot.onText(/\/sendall/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  if (!db.properties.length) return bot.sendMessage(msg.chat.id, "Нет объектов");
  const lastProp = db.properties[db.properties.length - 1];
  const clients  = Object.keys(db.clients || {});
  let sent = 0;
  bot.sendMessage(msg.chat.id, `📣 Рассылаю ${clients.length} клиентам...`);
  for (const id of clients) {
    try {
      await showProperty(id, lastProp, 0, 1);
      sent++;
      await new Promise(r => setTimeout(r, 500));
    } catch {}
  }
  bot.sendMessage(msg.chat.id, `✅ Готово! Отправлено: ${sent}/${clients.length}`);
});

bot.onText(/\/makler/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  bot.sendMessage(msg.chat.id, "🔍 Проверяю Makler прямо сейчас...");
  await checkNewAds();
  bot.sendMessage(msg.chat.id, "✅ Готово! Новые объявления если есть — уже в группе.");
});

// ===== КОНТАКТ =====
bot.on("contact", async (msg) => {
  const chatId = msg.chat.id;
  const phone  = msg.contact.phone_number;
  const u      = users[chatId] || {};
  await confirmLead(chatId, msg, phone, u.property);
});

// ===== CALLBACK =====
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data   = query.data;
  if (data === "noop") return bot.answerCallbackQuery(query.id);

  if (data.startsWith("prop_")) {
    const db    = loadDB();
    const index = parseInt(data.split("_")[1]);
    if (db.properties[index]) {
      await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      await showProperty(chatId, db.properties[index], index, db.properties.length);
    }
    return bot.answerCallbackQuery(query.id);
  }

  if (data.startsWith("want_")) {
    const db   = loadDB();
    const prop = db.properties.find(p => p.id === data.replace("want_", ""));
    users[chatId] = { type: "ПОКУПКА", property: prop?.title };
    bot.answerCallbackQuery(query.id);
    return bot.sendMessage(chatId,
      `Отлично! 😊\n\nНажмите кнопку ниже — менеджер свяжется для просмотра *${prop?.title || "объекта"}*`,
      { parse_mode: "Markdown", ...contactKeyboard }
    );
  }
});

// ===== ФОТО =====
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) {
    const u = users[chatId] || {};
    try {
      await bot.forwardMessage(ADMIN_ID, chatId, msg.message_id);
      await bot.sendMessage(ADMIN_ID, `📸 Фото от клиента\n👤 ${msg.from.first_name || "—"} @${msg.from.username || "нет"}\n📌 ${u.type || "не указан"}`);
    } catch {}
    return bot.sendMessage(chatId, "Фото получено! Менеджер свяжется с вами.", mainKeyboard);
  }
  const state = adminStates[chatId];
  if (!state || state.step !== "photo") return;
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  adminStates[chatId] = { ...state, photo: fileId, step: "title" };
  bot.sendMessage(chatId, "✅ Фото принято!\n\nШаг 2/6: Введи название:");
});

// ===== ОСНОВНОЙ ОБРАБОТЧИК =====
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text;
  if (!text || text.startsWith("/")) return;

  if (isAdmin(chatId) && adminStates[chatId]) {
    const state = adminStates[chatId];
    if (text === "/skip" && state.step === "photo") {
      adminStates[chatId] = { ...state, step: "title" };
      return bot.sendMessage(chatId, "Шаг 2/6: Название:");
    }
    if (state.step === "title")   { adminStates[chatId] = { ...state, title:   text, step: "address" };     return bot.sendMessage(chatId, "Шаг 3/6: Адрес:"); }
    if (state.step === "address") { adminStates[chatId] = { ...state, address: text, step: "price" };       return bot.sendMessage(chatId, "Шаг 4/6: Цена:"); }
    if (state.step === "price")   { adminStates[chatId] = { ...state, price:   text, step: "details" };     return bot.sendMessage(chatId, "Шаг 5/6: Детали (комнаты, площадь, этаж) или /skip:"); }
    if (state.step === "details") {
      let rooms = "", area = "", floor = "";
      if (text !== "/skip") {
        text.split(",").map(s => s.trim()).forEach(p => {
          if (p.includes("комнат")) rooms = p;
          else if (p.includes("м"))  area  = p;
          else if (p.includes("этаж")) floor = p;
        });
      }
      adminStates[chatId] = { ...state, rooms, area, floor, step: "description" };
      return bot.sendMessage(chatId, "Шаг 6/6: Описание или /skip:");
    }
    if (state.step === "description") {
      const db = loadDB();
      const newProp = {
        id: Date.now().toString(), photo: state.photo || null,
        title: state.title, address: state.address, price: state.price,
        rooms: state.rooms || "", area: state.area || "", floor: state.floor || "",
        description: text !== "/skip" ? text : "", date: new Date().toISOString()
      };
      db.properties.push(newProp);
      saveDB(db);
      delete adminStates[chatId];
      return bot.sendMessage(chatId,
        `✅ *Объект добавлен!*\n\n🏠 ${newProp.title}\n📍 ${newProp.address}\n💰 ${newProp.price}\n\nВсего: ${db.properties.length}\n\n📣 Разослать? → /broadcast`,
        { parse_mode: "Markdown" }
      );
    }
  }

  if (text === "🔙 Назад") return bot.sendMessage(chatId, "Выберите действие 👇", mainKeyboard);

  if (text === "📋 Смотреть объекты") {
    const db = loadDB();
    saveClient(chatId, "просмотр");
    if (!db.properties.length) return bot.sendMessage(chatId, "Сейчас обновляем каталог.\n📞 777 26536 / 777 72473", mainKeyboard);
    await bot.sendMessage(chatId, `📋 У нас ${db.properties.length} объектов 👇`, mainKeyboard);
    return showProperty(chatId, db.properties[0], 0, db.properties.length);
  }

  const quickActions = {
    "🏠 Купить недвижимость":    { type: "ПОКУПКА",   prompt: "Клиент хочет купить недвижимость. Спроси район и бюджет. Предложи каталог объектов." },
    "🏷 Продать недвижимость":   { type: "ПРОДАЖА",   prompt: "Клиент хочет продать. Скажи что бесплатно оценим. Попроси нажать кнопку отправки номера." },
    "🏢 Сдать недвижимость":     { type: "СДАЧА",     prompt: "Клиент хочет сдать. Скажи что специализируемся на продаже но можем помочь с оценкой." },
    "🔑 Снять недвижимость":     { type: "АРЕНДА",    prompt: "Клиент хочет снять. Скажи что занимаемся продажей и предложи посмотреть объекты на покупку." },
    "🏦 Рассчитать ипотеку":     { type: "ИПОТЕКА",   prompt: "Клиент хочет рассчитать ипотеку. Спроси стоимость, взнос и срок. Посчитай платёж." },
    "📄 Документы":              { type: "ДОКУМЕНТЫ", prompt: "Клиент спрашивает про документы для сделки в ПМР. Расскажи кратко." },
    "📞 Связаться с менеджером": { type: "СВЯЗЬ",     prompt: "Клиент хочет связаться. Скажи оставить номер — нажать кнопку." },
  };

  if (quickActions[text]) {
    const action = quickActions[text];
    users[chatId] = { type: action.type };
    saveClient(chatId, action.type);
    try {
      bot.sendChatAction(chatId, "typing");
      const reply = await askClaude(chatId, action.prompt);
      await bot.sendMessage(chatId, reply, mainKeyboard);
      return bot.sendMessage(chatId, "👇 Нажмите чтобы отправить номер:", contactKeyboard);
    } catch {
      return bot.sendMessage(chatId, "Произошла ошибка. Попробуйте ещё раз.", mainKeyboard);
    }
  }

  const phone = extractPhone(text);
  if (phone && phone.length >= 7) {
    const u = users[chatId] || {};
    await confirmLead(chatId, msg, phone, u.property);
    return;
  }

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

// ===== ЗАПУСК =====
(async () => {
  await initMaklerMonitor();
  setInterval(checkNewAds, CHECK_INTERVAL);
  console.log("РеалИнвест BOT + Makler мониторинг запущен!");
})();
