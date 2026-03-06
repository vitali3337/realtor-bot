require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic   = require("@anthropic-ai/sdk");
const fs          = require("fs");
const axios       = require("axios");
const cheerio     = require("cheerio");

// ===== КОНФИГУРАЦИЯ =====
const TOKEN         = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_GROUP   = -1003773163201;
const ADMIN_IDS     = (process.env.ADMIN_IDS || "5705817827").split(",").map(x => x.trim());
const DB_FILE       = "./properties.json";
const SEEN_FILE     = "./seen_ads.json";
const INTERVAL      = 5 * 60 * 1000; // 5 минут

if (!TOKEN)         { console.error("Нет TELEGRAM_TOKEN");   process.exit(1); }
if (!ANTHROPIC_KEY) { console.error("Нет ANTHROPIC_API_KEY"); process.exit(1); }

const bot    = new TelegramBot(TOKEN, { polling: true });
const claude = new Anthropic({ apiKey: ANTHROPIC_KEY });

bot.on("polling_error", e => console.log("Polling:", e.message));

// ===== СИСТЕМНЫЙ ПРОМПТ =====
const PROMPT = `Ты — вежливый помощник агентства недвижимости РеалИнвест в Тирасполе, Приднестровье.

Агентство:
- Адрес: ул. Восстания 10, Тирасполь
- Менеджеры: Сергей (777 26536), Александр (777 72487), Виталий (777 72473)
- Только продажа недвижимости в Приднестровье

Правила:
- Отвечай коротко, 2-3 предложения максимум
- Всегда предлагай посмотреть каталог объектов
- Когда клиент хочет оставить контакт — скажи нажать кнопку "Отправить мой номер"
- Только русский язык
- Будь дружелюбным и профессиональным`;

// ===== ХРАНИЛИЩЕ =====
const users       = {};
const history     = {};
const adminState  = {};

// ===== БАЗА ДАННЫХ =====
function db() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { properties: [], clients: {} }; }
}
function saveDb(d) { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }

function seen() {
  try { return JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")); }
  catch { return {}; }
}
function saveSeen(s) { fs.writeFileSync(SEEN_FILE, JSON.stringify(s, null, 2)); }

function isAdmin(id) { return ADMIN_IDS.includes(String(id)); }

function getHistory(id) {
  if (!history[id]) history[id] = [];
  return history[id];
}

function addHistory(id, role, content) {
  const h = getHistory(id);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
}

function saveClient(id, type) {
  const d = db();
  if (!d.clients) d.clients = {};
  d.clients[String(id)] = { type, date: new Date().toISOString() };
  saveDb(d);
}

function getPhone(text) {
  const clean = text.replace(/[^\d+]/g, "");
  const match = clean.match(/\+?[0-9]{7,15}/);
  return match ? match[0] : null;
}

// ===== КЛАВИАТУРЫ =====
const mainKb = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["📋 Смотреть объекты",    "🏦 Рассчитать ипотеку"],
      ["📄 Документы",           "📞 Связаться с менеджером"]
    ],
    resize_keyboard: true
  }
};

const contactKb = {
  reply_markup: {
    keyboard: [
      [{ text: "📱 Отправить мой номер", request_contact: true }],
      ["🔙 Назад в меню"]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  }
};

// ===== ПОКАЗ ОБЪЕКТА =====
async function showProp(chatId, prop, idx, total) {
  const text =
    `🏠 *${prop.title}*\n\n` +
    `📍 Адрес: ${prop.address}\n` +
    `💰 Цена: *${prop.price}*\n` +
    (prop.rooms ? `🛏 Комнат: ${prop.rooms}\n` : "") +
    (prop.area  ? `📐 Площадь: ${prop.area}\n`  : "") +
    (prop.floor ? `🏢 Этаж: ${prop.floor}\n`    : "") +
    (prop.desc  ? `\n📝 ${prop.desc}\n`          : "") +
    `\n━━━━━━━━━━━━━━━\n` +
    `📞 777 26536 / 777 72473\n` +
    `📍 ул. Восстания 10, Тирасполь`;

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📱 Хочу посмотреть — записаться", callback_data: `want_${prop.id}` }],
        [
          { text: idx > 0       ? "⬅️ Пред" : "·", callback_data: idx > 0       ? `p_${idx-1}` : "noop" },
          { text: `${idx+1} из ${total}`,            callback_data: "noop" },
          { text: idx < total-1 ? "След ➡️" : "·", callback_data: idx < total-1 ? `p_${idx+1}` : "noop" }
        ]
      ]
    }
  };

  try {
    if (prop.photo) {
      await bot.sendPhoto(chatId, prop.photo, { caption: text, parse_mode: "Markdown", ...kb });
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...kb });
    }
  } catch {
    await bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...kb });
  }
}

// ===== CLAUDE AI =====
async function askClaude(chatId, msg) {
  addHistory(chatId, "user", msg);
  const res = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 400,
    system: PROMPT,
    messages: getHistory(chatId)
  });
  const reply = res.content[0]?.text || "Извините, попробуйте ещё раз.";
  addHistory(chatId, "assistant", reply);
  return reply;
}

// ===== ОТПРАВКА ЗАЯВКИ =====
async function sendLead(msg, phone, propTitle) {
  const u = users[msg.chat.id] || {};
  const text =
    `📥 *НОВАЯ ЗАЯВКА — РеалИнвест*\n\n` +
    `📌 Тип: ${u.type || "Покупка"}\n` +
    (propTitle ? `🏠 Объект: ${propTitle}\n` : "") +
    `👤 Имя: ${msg.from.first_name || "—"} ${msg.from.last_name || ""}\n` +
    `📎 @${msg.from.username || "нет"}\n` +
    `🆔 ID: ${msg.from.id}\n` +
    `📱 *Телефон: ${phone}*\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `👨‍💼 Менеджеры:\n` +
    `• Сергей: 777 26536\n` +
    `• Александр: 777 72487\n` +
    `• Виталий: 777 72473`;

  await bot.sendMessage(ADMIN_GROUP, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [[
      { text: `📞 Позвонить ${phone}`, url: `tel:${phone.replace(/\D/g,"")}` }
    ]]}
  }).catch(e => console.error("Ошибка заявки:", e.message));
}

async function confirmLead(chatId, msg, phone, propTitle) {
  await sendLead(msg, phone, propTitle);
  delete users[chatId];
  history[chatId] = [];
  saveClient(chatId, "заявка");
  await bot.sendMessage(chatId,
    `✅ *Заявка принята!*\n\n` +
    `Менеджер свяжется с вами в ближайшее время.\n\n` +
    `📍 ул. Восстания 10, Тирасполь\n` +
    `📞 777 26536 / 777 72473`,
    { parse_mode: "Markdown", ...mainKb }
  );
}

// ===== МОНИТОРИНГ MAKLER.MD =====
const MAKLER = [
  { url: "https://makler.md/tiraspol/real-estate/real-estate-for-sale/apartments-for-sale/", city: "Тирасполь", type: "Квартира" },
  { url: "https://makler.md/tiraspol/real-estate/real-estate-for-sale/houses-for-sale/",     city: "Тирасполь", type: "Дом" },
  { url: "https://makler.md/bender/real-estate/real-estate-for-sale/apartments-for-sale/",   city: "Бендеры",   type: "Квартира" },
  { url: "https://makler.md/bender/real-estate/real-estate-for-sale/houses-for-sale/",       city: "Бендеры",   type: "Дом" },
  { url: "https://makler.md/ribnitsa/real-estate/real-estate-for-sale/apartments-for-sale/", city: "Рыбница",   type: "Квартира" },
];

async function parseMakler() {
  const ads = [];
  for (const item of MAKLER) {
    try {
      const { data } = await axios.get(item.url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0" },
        timeout: 15000
      });
      const $ = cheerio.load(data);

      $("a[href*='/an/']").each((i, el) => {
        const href  = $(el).attr("href") || "";
        const title = $(el).text().trim();
        if (!href || title.length < 5) return;

        // Только собственники — фильтруем агентства
        const low = title.toLowerCase();
        if (low.includes("агентство") || low.includes("риелтор") || low.includes("агент")) return;

        const parent = $(el).closest("div, li, article, .announcement");
        const price  = parent.find("[class*='price'], .price").first().text().trim();
        const phone  = parent.find("[class*='phone'], .phone").first().text().trim();
        const img    = parent.find("img[src*='http']").first().attr("src") || "";
        const link   = href.startsWith("http") ? href : "https://makler.md" + href;

        ads.push({
          id: link, title: title.substring(0, 120),
          price: price || "Цена не указана",
          phone: phone || "Смотри на сайте",
          link, img, city: item.city, type: item.type
        });
      });

      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.error(`Ошибка парсинга ${item.city}:`, e.message);
    }
  }
  return ads;
}

async function checkMakler() {
  console.log(`[${new Date().toLocaleTimeString()}] Проверяю Makler...`);
  const s       = seen();
  const isFirst = Object.keys(s).length === 0;
  const ads     = await parseMakler();
  let newCount  = 0;

  for (const ad of ads) {
    if (!s[ad.id]) {
      s[ad.id] = Date.now();
      newCount++;

      if (!isFirst) {
        try {
          const msg =
            `🔥 *Новый объект на Makler!*\n\n` +
            `🏙 ${ad.city} — ${ad.type}\n` +
            `📝 ${ad.title}\n` +
            `💰 ${ad.price}\n` +
            `📱 ${ad.phone}\n\n` +
            `🔗 ${ad.link}\n\n` +
            `━━━━━━━━━━━━━━━\n` +
            `💼 Позвони первым — предложи услуги РеалИнвест!`;

          const kb = {
            reply_markup: { inline_keyboard: [[
              ...(ad.phone !== "Смотри на сайте"
                ? [{ text: "📞 Позвонить", url: `tel:${ad.phone.replace(/\D/g,"")}` }]
                : []
              ),
              { text: "🔗 Открыть", url: ad.link }
            ]]}
          };

          if (ad.img) {
            await bot.sendPhoto(ADMIN_GROUP, ad.img, { caption: msg, parse_mode: "Markdown", ...kb })
              .catch(() => bot.sendMessage(ADMIN_GROUP, msg, { parse_mode: "Markdown", ...kb }));
          } else {
            await bot.sendMessage(ADMIN_GROUP, msg, { parse_mode: "Markdown", ...kb });
          }

          await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
          console.error("Ошибка отправки:", e.message);
        }
      }
    }
  }

  saveSeen(s);

  if (isFirst) {
    console.log(`База Makler собрана: ${ads.length} объявлений`);
    await bot.sendMessage(ADMIN_GROUP,
      `✅ *Мониторинг Makler.md запущен!*\n\n` +
      `📊 Запомнил ${ads.length} объявлений\n` +
      `⏰ Проверяю каждые 5 минут\n\n` +
      `📍 Слежу за:\n` +
      `• Тирасполь — квартиры и дома\n` +
      `• Бендеры — квартиры и дома\n` +
      `• Рыбница — квартиры\n\n` +
      `🔔 Новые объявления сразу пришлю сюда!\n\n` +
      `_Только собственники — агентства отфильтрованы_`,
      { parse_mode: "Markdown" }
    ).catch(() => {});
  } else if (newCount > 0) {
    console.log(`Новых: ${newCount}`);
  } else {
    console.log("Новых объявлений нет");
  }
}

// ===== КОМАНДЫ =====
bot.onText(/\/start/, msg => {
  const id   = msg.chat.id;
  const name = msg.from.first_name || "";
  users[id]   = {};
  history[id] = [];
  saveClient(id, "новый");
  bot.sendMessage(id,
    `👋 Здравствуйте${name ? ", " + name : ""}!\n\n` +
    `Добро пожаловать в *РеалИнвест* 🏠\n\n` +
    `Мы помогаем купить и продать недвижимость в Приднестровье.\n\n` +
    `📍 ул. Восстания 10, Тирасполь\n` +
    `📞 777 26536 / 777 72473\n\n` +
    `Выберите действие 👇`,
    { parse_mode: "Markdown", ...mainKb }
  );
});

bot.onText(/\/clear/, msg => {
  users[msg.chat.id]   = {};
  history[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, "Начнём сначала! 👋", mainKb);
});

bot.onText(/\/add/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  adminState[msg.chat.id] = { step: "photo" };
  bot.sendMessage(msg.chat.id,
    `📸 *Добавление объекта*\n\nШаг 1/6: Отправь фото объекта\n_(или /skip чтобы без фото)_`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/list/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  const d = db();
  if (!d.properties.length) return bot.sendMessage(msg.chat.id, "Объектов нет. Добавь через /add");
  let text = `📋 *Объекты (${d.properties.length}):*\n\n`;
  d.properties.forEach((p, i) => { text += `${i+1}. ${p.title} — ${p.price}\n`; });
  text += "\n✏️ Удалить: /delete номер";
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/delete (.+)/, (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const d   = db();
  const idx = parseInt(match[1]) - 1;
  if (idx < 0 || idx >= d.properties.length) return bot.sendMessage(msg.chat.id, "Неверный номер");
  const rem = d.properties.splice(idx, 1)[0];
  saveDb(d);
  bot.sendMessage(msg.chat.id, `✅ Удалено: "${rem.title}"`);
});

bot.onText(/\/broadcast/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  const d     = db();
  const count = Object.keys(d.clients || {}).length;
  bot.sendMessage(msg.chat.id,
    `📣 Разослать последний объект *${count}* клиентам?\n\nНапиши /sendall для подтверждения`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/sendall/, async msg => {
  if (!isAdmin(msg.chat.id)) return;
  const d = db();
  if (!d.properties.length) return bot.sendMessage(msg.chat.id, "Нет объектов для рассылки");
  const last    = d.properties[d.properties.length - 1];
  const clients = Object.keys(d.clients || {});
  let sent = 0;
  await bot.sendMessage(msg.chat.id, `📣 Рассылаю ${clients.length} клиентам...`);
  for (const id of clients) {
    try {
      await showProp(id, last, 0, 1);
      sent++;
      await new Promise(r => setTimeout(r, 600));
    } catch {}
  }
  bot.sendMessage(msg.chat.id, `✅ Рассылка завершена! Отправлено: ${sent}/${clients.length}`);
});

bot.onText(/\/makler/, async msg => {
  if (!isAdmin(msg.chat.id)) return;
  await bot.sendMessage(msg.chat.id, "🔍 Проверяю Makler.md прямо сейчас...");
  // Временно сбрасываем флаг первого запуска
  const s = seen();
  s["_check"] = true;
  saveSeen(s);
  await checkMakler();
  bot.sendMessage(msg.chat.id, "✅ Проверка завершена!");
});

bot.onText(/\/stats/, msg => {
  if (!isAdmin(msg.chat.id)) return;
  const d       = db();
  const s       = seen();
  const clients = Object.keys(d.clients || {}).length;
  const props   = d.properties.length;
  const makler  = Object.keys(s).length;
  bot.sendMessage(msg.chat.id,
    `📊 *Статистика РеалИнвест*\n\n` +
    `👥 Клиентов в базе: ${clients}\n` +
    `🏠 Объектов в каталоге: ${props}\n` +
    `📡 Makler объявлений в базе: ${makler}\n\n` +
    `⏰ Мониторинг: каждые 5 минут`,
    { parse_mode: "Markdown" }
  );
});

// ===== КОНТАКТ =====
bot.on("contact", async msg => {
  const id = msg.chat.id;
  const u  = users[id] || {};
  await confirmLead(id, msg, msg.contact.phone_number, u.property);
});

// ===== CALLBACK =====
bot.on("callback_query", async q => {
  const id   = q.message.chat.id;
  const data = q.data;
  if (data === "noop") return bot.answerCallbackQuery(q.id);

  if (data.startsWith("p_")) {
    const d   = db();
    const idx = parseInt(data.split("_")[1]);
    if (d.properties[idx]) {
      await bot.deleteMessage(id, q.message.message_id).catch(() => {});
      await showProp(id, d.properties[idx], idx, d.properties.length);
    }
    return bot.answerCallbackQuery(q.id);
  }

  if (data.startsWith("want_")) {
    const d    = db();
    const prop = d.properties.find(p => p.id === data.replace("want_", ""));
    users[id]  = { type: "ПОКУПКА", property: prop?.title };
    bot.answerCallbackQuery(q.id);
    return bot.sendMessage(id,
      `Отлично! 😊\n\nНажмите кнопку ниже чтобы отправить номер телефона.\nМенеджер свяжется для организации просмотра *${prop?.title || "объекта"}*.`,
      { parse_mode: "Markdown", ...contactKb }
    );
  }
});

// ===== ФОТО ОТ ПОЛЬЗОВАТЕЛЯ =====
bot.on("photo", async msg => {
  const id = msg.chat.id;
  
