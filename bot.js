
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================
const TOKEN = process.env.TELEGRAM_TOKEN;
const AI_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_GROUP = -1003773163201;
const ADMIN_IDS = (process.env.ADMIN_IDS || "5705817827").split(",").map(s => s.trim());
const DB_FILE = "./db.json";
const SEEN_FILE = "./seen.json";
const INTERVAL = 5 * 60 * 1000;

if (!TOKEN) { console.error("Нет TELEGRAM_TOKEN"); process.exit(1); }
if (!AI_KEY) { console.error("Нет ANTHROPIC_API_KEY"); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: true });
const ai = new Anthropic({ apiKey: AI_KEY });

bot.on("polling_error", e => console.error("polling:", e.message));
bot.on("error", e => console.error("bot error:", e.message));

// ============================================================
// БАЗА ДАННЫХ
// ============================================================
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { properties: [], clients: {} }; }
}
function saveDB(d) { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }
function loadSeen() {
  try { return JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")); }
  catch { return {}; }
}
function saveSeen(s) { fs.writeFileSync(SEEN_FILE, JSON.stringify(s, null, 2)); }

function saveClient(id, type) {
  const db = loadDB();
  db.clients[String(id)] = { type, date: new Date().toISOString() };
  saveDB(db);
}

function isAdmin(id) { return ADMIN_IDS.includes(String(id)); }

// ============================================================
// СОСТОЯНИЯ
// ============================================================
const userState = {};    // { type, property }
const chatHistory = {};  // история диалога
const addState = {};     // состояние добавления объекта

function getHistory(id) {
  if (!chatHistory[id]) chatHistory[id] = [];
  return chatHistory[id];
}
function pushHistory(id, role, content) {
  const h = getHistory(id);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, 2);
}

function getPhone(text) {
  const m = text.replace(/[^\d+]/g, "").match(/\+?\d{7,15}/);
  return m ? m[0] : null;
}

// ============================================================
// КЛАВИАТУРЫ
// ============================================================
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

// ============================================================
// CLAUDE AI
// ============================================================
const SYSTEM = `Ты — помощник агентства недвижимости РеалИнвест, Тирасполь, Приднестровье.
Агентство: ул. Восстания 10. Тел: 777 26536, 777 72473.
Менеджеры: Сергей (777 26536), Александр (777 72487), Виталий (777 72473).
Работаем только с продажей недвижимости в Приднестровье.
Правила: отвечай коротко (2-3 предложения), только русский язык,
всегда предлагай посмотреть каталог или оставить номер телефона.`;

async function askClaude(id, text) {
  pushHistory(id, "user", text);
  try {
    const res = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 350,
      system: SYSTEM,
      messages: getHistory(id)
    });
    const reply = res.content[0]?.text || "Попробуйте ещё раз.";
    pushHistory(id, "assistant", reply);
    return reply;
  } catch (e) {
    console.error("Claude error:", e.message);
    throw e;
  }
}

// ============================================================
// ПОКАЗ ОБЪЕКТА
// ============================================================
async function showProperty(chatId, prop, idx, total) {
  const caption =
    `🏠 *${prop.title}*\n\n` +
    `📍 ${prop.address}\n` +
    `💰 Цена: *${prop.price}*\n` +
    (prop.rooms ? `🛏 Комнат: ${prop.rooms}\n` : "") +
    (prop.area  ? `📐 Площадь: ${prop.area}\n`  : "") +
    (prop.floor ? `🏢 Этаж: ${prop.floor}\n`    : "") +
    (prop.desc  ? `\n📝 ${prop.desc}\n`          : "") +
    `\n─────────────────\n` +
    `📞 777 26536 / 777 72473\n` +
    `📍 ул. Восстания 10`;

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Хочу посмотреть", callback_data: `want:${prop.id}` }],
        [
          { text: idx > 0        ? "◀ Пред" : "·",    callback_data: idx > 0        ? `prop:${idx - 1}` : "noop" },
          { text: `${idx + 1} / ${total}`,              callback_data: "noop" },
          { text: idx < total - 1 ? "След ▶" : "·",   callback_data: idx < total - 1 ? `prop:${idx + 1}` : "noop" }
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
  } catch {
    await bot.sendMessage(chatId, caption, { parse_mode: "Markdown", ...kb });
  }
}

// ============================================================
// ЗАЯВКА В ГРУППУ
// ============================================================
async function sendLead(msg, phone) {
  const u = userState[msg.chat.id] || {};
  const text =
    `📥 *НОВАЯ ЗАЯВКА — РеалИнвест*\n\n` +
    `📌 Тип: ${u.type || "Покупка"}\n` +
    (u.property ? `🏠 Объект: ${u.property}\n` : "") +
    `👤 ${msg.from.first_name || "—"} ${msg.from.last_name || ""}\n` +
    `📎 @${msg.from.username || "нет"}\n` +
    `🆔 ${msg.from.id}\n` +
    `📱 *${phone}*`;

  await bot.sendMessage(ADMIN_GROUP, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[
        { text: `📞 Позвонить ${phone}`, url: `tel:${phone.replace(/\D/g, "")}` }
      ]]
    }
  }).catch(e => console.error("lead error:", e.message));
}

async function confirmLead(chatId, msg, phone) {
  await sendLead(msg, phone);
  delete userState[chatId];
  chatHistory[chatId] = [];
  saveClient(chatId, "заявка");
  bot.sendMessage(chatId,
    `✅ *Заявка принята!*\n\nМенеджер свяжется с вами в ближайшее время.\n\n📍 ул. Восстания 10\n📞 777 26536 / 777 72473`,
    { parse_mode: "Markdown", ...mainKb }
  );
}

// ============================================================
// МОНИТОРИНГ MAKLER.MD
// ============================================================
const MAKLER_URLS = [
  { url: "https://makler.md/tiraspol/real-estate/real-estate-for-sale/apartments-for-sale/", city: "Тирасполь", type: "Квартира" },
  { url: "https://makler.md/tiraspol/real-estate/real-estate-for-sale/houses-for-sale/",     city: "Тирасполь", type: "Дом" },
  { url: "https://makler.md/bender/real-estate/real-estate-for-sale/apartments-for-sale/",   city: "Бендеры",   type: "Квартира" },
  { url: "https://makler.md/bender/real-estate/real-estate-for-sale/houses-for-sale/",       city: "Бендеры",   type: "Дом" },
  { url: "https://makler.md/ribnitsa/real-estate/real-estate-for-sale/apartments-for-sale/", city: "Рыбница",   type: "Квартира" }
];

async function parseMakler() {
  const ads = [];
  for (const item of MAKLER_URLS) {
    try {
      const { data } = await axios.get(item.url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 12000
      });
      const $ = cheerio.load(data);
      $("a[href*='/an/']").each((_, el) => {
        const href = $(el).attr("href") || "";
        const title = $(el).text().trim();
        if (!href || title.length < 5) return;
        const low = title.toLowerCase();
        if (low.includes("агентство") || low.includes("риелтор") || low.includes("агент")) return;
        const parent = $(el).closest("div,li,article");
        const price  = parent.find("[class*=price]").first().text().trim();
        const phone  = parent.find("[class*=phone]").first().text().trim();
        const img    = parent.find("img[src*=http]").first().attr("src") || "";
        const link   = href.startsWith("http") ? href : "https://makler.md" + href;
        ads.push({ id: link, title: title.slice(0, 100), price: price || "", phone: phone || "", img, link, city: item.city, type: item.type });
      });
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.error(`parseMakler ${item.city}:`, e.message);
    }
  }
  return ads;
}

async function checkMakler() {
  console.log(`[${new Date().toLocaleTimeString()}] Проверяю Makler...`);
  const s = loadSeen();
  const isFirst = Object.keys(s).length === 0;
  const ads = await parseMakler();
  let newCount = 0;

  for (const ad of ads) {
    if (s[ad.id]) continue;
    s[ad.id] = Date.now();
    newCount++;
    if (isFirst) continue;

    try {
      const text =
        `🔥 *Новый объект на Makler.md*\n\n` +
        `🏙 ${ad.city} — ${ad.type}\n` +
        `📝 ${ad.title}\n` +
        (ad.price ? `💰 ${ad.price}\n` : "") +
        (ad.phone ? `📱 ${ad.phone}\n` : "") +
        `\n🔗 ${ad.link}\n\n` +
        `─────────────────\n` +
        `💼 Позвони первым — предложи услуги РеалИнвест!`;

      const inlineKb = { reply_markup: { inline_keyboard: [[
        ...(ad.phone ? [{ text: "📞 Позвонить", url: `tel:${ad.phone.replace(/\D/g, "")}` }] : []),
        { text: "🔗 Открыть", url: ad.link }
      ]] } };

      if (ad.img) {
        await bot.sendPhoto(ADMIN_GROUP, ad.img, { caption: text, parse_mode: "Markdown", ...inlineKb })
          .catch(() => bot.sendMessage(ADMIN_GROUP, text, { parse_mode: "Markdown", ...inlineKb }));
      } else {
        await bot.sendMessage(ADMIN_GROUP, text, { parse_mode: "Markdown", ...inlineKb });
      }
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.error("makler notify:", e.message);
    }
  }

  saveSeen(s);

  if (isFirst) {
    console.log(`Makler база: ${ads.length} объявлений`);
    bot.sendMessage(ADMIN_GROUP,
      `✅ *Мониторинг Makler.md запущен!*\n\n` +
      `📊 Запомнил ${ads.length} объявлений\n` +
      `⏰ Проверка каждые 5 минут\n\n` +
      `📍 Слежу: Тирасполь, Бендеры, Рыбница\n` +
      `🔍 Только собственники (агентства отфильтрованы)`,
      { parse_mode: "Markdown" }
    ).catch(() => {});
  } else {
    console.log(newCount > 0 ? `Новых: ${newCount}` : "Новых нет");
  }
}

// ============================================================
// КОМАНДЫ
// ============================================================
bot.onText(/\/start/, msg => {
  const id = msg.chat.id;
  userState[id] = {};
  chatHistory[id] = [];
  saveClient(id, "старт");
  const name = msg.from.first_name || "";
  bot.sendMessage(id,
    `👋 Здравствуйте${name ? ", " + name : ""}!\n\n` +
    `Добро пожаловать в *РеалИнвест* 🏠\n\n` +
    `Продажа недвижимости в Приднестровье\n\n` +
    `📍 ул. Восстания 10, Тирасполь\n` +
    `📞 777 26536 / 777 72473\n\n` +
    `Выберите действие 👇`,
    { parse_mode: "Markdown", ...mainKb }
  );
});

bot.onText(/\/clear/, msg => {
  userState[msg.chat.id] = {};
  chatHistory[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, "Начнём сначала! 👋", mainKb);
});

bot.onText(/\/add/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  addState[msg.chat.id] = { step: "photo" };
  bot.sendMessage(msg.chat.id, "📸 Шаг 1/6: Отправь фото объекта\n_(или /skip)_", { parse_mode: "Markdown" });
});

bot.onText(/\/list/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  if (!db.properties.length) return bot.sendMessage(msg.chat.id, "Объектов нет. Добавь через /add");
  let text = `📋 *Объекты (${db.properties.length}):*\n\n`;
  db.properties.forEach((p, i) => { text += `${i + 1}. ${p.title} — ${p.price}\n`; });
  text += "\n/delete N — удалить";
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/delete (\d+)/, (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  const i = parseInt(match[1]) - 1;
  if (i < 0 || i >= db.properties.length) return bot.sendMessage(msg.chat.id, "Неверный номер");
  const rem = db.properties.splice(i, 1)[0];
  saveDB(db);
  bot.sendMessage(msg.chat.id, `✅ Удалено: ${rem.title}`);
});

bot.onText(/\/broadcast/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  const n = Object.keys(db.clients).length;
  bot.sendMessage(msg.chat.id, `📣 Разослать последний объект *${n}* клиентам?\n/sendall — подтвердить`, { parse_mode: "Markdown" });
});

bot.onText(/\/sendall/, async msg => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  if (!db.properties.length) return bot.sendMessage(msg.chat.id, "Нет объектов");
  const prop = db.properties[db.properties.length - 1];
  const clients = Object.keys(db.clients);
  let sent = 0;
  bot.sendMessage(msg.chat.id, `📣 Рассылаю ${clients.length} клиентам...`);
  for (const id of clients) {
    try { await showProperty(id, prop, 0, 1); sent++; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  bot.sendMessage(msg.chat.id, `✅ Отправлено: ${sent}/${clients.length}`);
});

bot.onText(/\/makler/, async msg => {
  if (!isAdmin(msg.chat.id)) return;
  bot.sendMessage(msg.chat.id, "🔍 Проверяю Makler.md...");
  await checkMakler();
  bot.sendMessage(msg.chat.id, "✅ Готово!");
});

bot.onText(/\/stats/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  const s = loadSeen();
  bot.sendMessage(msg.chat.id,
    `📊 *Статистика*\n\n` +
    `👥 Клиентов: ${Object.keys(db.clients).length}\n` +
    `🏠 Объектов: ${db.properties.length}\n` +
    `📡 Makler база: ${Object.keys(s).length}\n` +
    `⏰ Проверка: каждые 5 мин`,
    { parse_mode: "Markdown" }
  );
});

// ============================================================
// КОНТАКТ
// ============================================================
bot.on("contact", async msg => {
  const id = msg.chat.id;
  await confirmLead(id, msg, msg.contact.phone_number);
});

// ============================================================
// CALLBACK КНОПКИ
// ============================================================
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
    userState[id] = { type: "ПОКУПКА", property: prop?.title };
    bot.sendMessage(id,
      `Отлично! 😊\n\nНажмите кнопку ниже чтобы отправить номер телефона.\nМенеджер свяжется для просмотра *${prop?.title || "объекта"}*.`,
      { parse_mode: "Markdown", ...contactKb }
    );
  }
});

// ============================================================
// ФОТО ОТ ПОЛЬЗОВАТЕЛЯ
// ============================================================
bot.on("photo", async msg => {
  const id = msg.chat.id;

  // Если это НЕ админ — пересылаем фото в группу
  if (!isAdmin(id)) {
    const u = userState[id] || {};
    try {
      await bot.forwardMessage(ADMIN_GROUP, id, msg.message_id);
      await bot.sendMessage(ADMIN_GROUP, `📸 Фото от клиента\n👤 ${msg.from.first_name || "—"} @${msg.from.username || "нет"}\n📌 ${u.type || "—"}`);
    } catch {}
    return bot.sendMessage(id, "Фото получено! Менеджер свяжется с вами.", mainKb);
  }

  // Админ добавляет объект
  const st = addState[id];
  if (!st || st.step !== "photo") return;
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  addState[id] = { ...st, photo: fileId, step: "title" };
  bot.sendMessage(id, "✅ Фото принято!\n\nШаг 2/6: Название объекта:");
});

// ============================================================
// ОСНОВНОЙ ОБРАБОТЧИК СООБЩЕНИЙ
// ============================================================
bot.on("message", async msg => {
  const id = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  // ── РЕЖИМ ДОБАВЛЕНИЯ ОБЪЕКТА (только для админа) ──────────
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
      return bot.sendMessage(id, "Шаг 4/6: Цена (например: 35 000$):");
    }
    if (st.step === "price") {
      addState[id] = { ...st, price: text, step: "details" };
      return bot.sendMessage(id, "Шаг 5/6: Детали через запятую\n(комнаты, площадь, этаж)\nили /skip");
    }
    if (st.step === "details") {
      let rooms = "", area = "", floor = "";
      if (text !== "/skip") {
        text.split(",").map(s => s.trim()).forEach(p => {
          if (/комнат/i.test(p))    rooms = p;
          else if (/м²|м2|кв/i.test(p)) area = p;
          else if (/этаж/i.test(p)) floor = p;
        });
      }
      addState[id] = { ...st, rooms, area, floor, step: "desc" };
      return bot.sendMessage(id, "Шаг 6/6: Описание (или /skip):");
    }
    if (st.step === "desc") {
      const db = loadDB();
      const prop = {
        id:      String(Date.now()),
        photo:   st.photo || null,
        title:   st.title,
        address: st.address,
        price:   st.price,
        rooms:   st.rooms || "",
        area:    st.area  || "",
        floor:   st.floor || "",
        desc:    text !== "/skip" ? text : "",
        date:    new Date().toISOString()
      };
      db.properties.push(prop);
      saveDB(db);
      delete addState[id];
      return bot.sendMessage(id,
        `✅ *Объект добавлен!*\n\n🏠 ${prop.title}\n📍 ${prop.address}\n💰 ${prop.price}\n\nВсего: ${db.properties.length}\n\n📣 Разослать? /broadcast`,
        { parse_mode: "Markdown" }
      );
    }
  }

  // ── КНОПКИ МЕНЮ ───────────────────────────────────────────
  if (text === "🔙 Назад") {
    return bot.sendMessage(id, "Выберите действие 👇", mainKb);
  }

  if (text === "📋 Смотреть объекты") {
    saveClient(id, "просмотр");
    const db = loadDB();
    if (!db.properties.length) {
      return bot.sendMessage(id, `Каталог пополняется.\nПозвоните: 📞 777 26536 / 777 72473`, mainKb);
    }
    await bot.sendMessage(id, `📋 *${db.properties.length} объектов в продаже* 👇`, { parse_mode: "Markdown", ...mainKb });
    return showProperty(id, db.properties[0], 0, db.properties.length);
  }

  const MENU = {
    "🏠 Купить недвижимость": { type: "ПОКУПКА",   prompt: "Клиент хочет купить недвижимость в Приднестровье. Спроси район и бюджет. Предложи посмотреть каталог объектов." },
    "🏷 Продать недвижимость": { type: "ПРОДАЖА",   prompt: "Клиент хочет продать недвижимость. Скажи что бесплатно оценим и быстро найдём покупателя. Попроси оставить номер." },
    "🏦 Ипотека":              { type: "ИПОТЕКА",   prompt: "Клиент хочет узнать про ипотеку. Спроси стоимость объекта, первоначальный взнос и срок. Посчитай платёж." },
    "📄 Документы":            { type: "ДОКУМЕНТЫ", prompt: "Клиент спрашивает про документы для купли-продажи в ПМР. Объясни кратко что нужно." },
    "📞 Менеджер":   
