require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");

// ENV
const TOKEN = process.env.TELEGRAM_TOKEN;
const AI_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_GROUP = Number(process.env.ADMIN_GROUP) || -1003773163201;
const ADMIN_IDS = (process.env.ADMIN_IDS || "5705817827").split(",");

if (!TOKEN) {
  console.log("8532518038:AAFLRsoSdUdhV0NFBkCT9k6BGS-BhD_xexI
              ");
  process.exit();
}

const bot = new TelegramBot(TOKEN, { polling: true });

let ai = null;
if (AI_KEY) {
  ai = new Anthropic({ apiKey: AI_KEY });
}

// DATABASE
const DB_FILE = "./db.json";

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE));
  } catch {
    return { properties: [], clients: {} };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function saveClient(id, type = "user") {
  const db = loadDB();
  db.clients[id] = {
    type,
    date: new Date().toISOString()
  };
  saveDB(db);
}

function isAdmin(id) {
  return ADMIN_IDS.includes(String(id));
}

// HISTORY
const history = {};

function pushHistory(id, role, text) {
  if (!history[id]) history[id] = [];

  history[id].push({
    role,
    content: text
  });

  if (history[id].length > 12) history[id].shift();
}

// AI SYSTEM PROMPT
const SYSTEM = `
Ты помощник агентства недвижимости РеалИнвест.

Город Тирасполь
Адрес: ул. Восстания 10

Менеджеры:
Сергей 77726536
Александр 77772487
Виталий 77772473

Отвечай коротко.
`;

// AI FUNCTION
async function askAI(id, text) {

  if (!ai) return null;

  try {

    pushHistory(id, "user", text);

    const res = await ai.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 200,
      system: SYSTEM,
      messages: history[id]
    });

    const reply = res?.content?.[0]?.text || null;

    if (reply) {
      pushHistory(id, "assistant", reply);
    }

    return reply;

  } catch (err) {

    console.log("AI ERROR:", err.message);
    return null;

  }

}

// SEARCH
function searchProperties(query) {

  const db = loadDB();
  query = query.toLowerCase();

  return db.properties.filter(p =>
    (p.title || "").toLowerCase().includes(query) ||
    (p.address || "").toLowerCase().includes(query) ||
    (p.price || "").toLowerCase().includes(query) ||
    (p.rooms || "").toLowerCase().includes(query)
  );

}

// SHOW PROPERTY
async function showProperty(chatId, prop, idx, total) {

  const caption =
`🏠 ${prop.title}

📍 ${prop.address}

💰 ${prop.price}

${prop.rooms || ""}
${prop.area || ""}
${prop.floor || ""}

${prop.desc || ""}

☎ 77726536 / 77772473
ул. Восстания 10`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Хочу посмотреть", callback_data: "want:" + prop.id }],
        [
          { text: "⬅", callback_data: "prop:" + (idx - 1) },
          { text: (idx + 1) + "/" + total, callback_data: "noop" },
          { text: "➡", callback_data: "prop:" + (idx + 1) }
        ]
      ]
    }
  };

  try {

    if (prop.photo)
      await bot.sendPhoto(chatId, prop.photo, { caption, ...keyboard });
    else
      await bot.sendMessage(chatId, caption, keyboard);

  } catch (err) {

    console.log("showProperty error:", err.message);
    await bot.sendMessage(chatId, caption);

  }

}

// PHONE PARSER
function getPhone(text) {
  const m = text.replace(/[^\d+]/g, "").match(/\+?\d{7,15}/);
  return m ? m[0] : null;
}

// STATES
const userState = {};
const addState = {};

// KEYBOARDS
const mainKb = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить", "🏷 Продать"],
      ["📋 Объекты", "🏦 Ипотека"],
      ["📞 Менеджер"]
    ],
    resize_keyboard: true
  }
};

const contactKb = {
  reply_markup: {
    keyboard: [
      [{ text: "📱 Отправить номер", request_contact: true }]
    ],
    resize_keyboard: true
  }
};

// START
bot.onText(/\/start/, msg => {

  const id = msg.chat.id;

  saveClient(id, "start");

  bot.sendMessage(id,
`Добро пожаловать в РеалИнвест

Продажа недвижимости в Тирасполе

ул. Восстания 10
☎ 77726536 / 77772473`,
mainKb);

});

// VIEW OBJECTS
bot.onText(/📋 Объекты/, async msg => {

  const db = loadDB();

  if (!db.properties.length)
    return bot.sendMessage(msg.chat.id, "Объектов пока нет");

  await showProperty(msg.chat.id, db.properties[0], 0, db.properties.length);

});

// CONTACT
bot.on("contact", async msg => {

  const phone = msg.contact.phone_number;

  const text =
`📥 НОВАЯ ЗАЯВКА

Имя: ${msg.from.first_name}
Телефон: ${phone}
ID: ${msg.from.id}`;

  try {
    await bot.sendMessage(ADMIN_GROUP, text);
  } catch (err) {
    console.log("Lead error:", err.message);
  }

  bot.sendMessage(msg.chat.id,
`Спасибо! Менеджер скоро свяжется.`,
mainKb);

});

// ADD PROPERTY
bot.onText(/\/add/, msg => {

  if (!isAdmin(msg.chat.id)) return;

  addState[msg.chat.id] = { step: "title" };

  bot.sendMessage(msg.chat.id, "Название объекта:");

});

// MESSAGE HANDLER
bot.on("message", async msg => {

  const id = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // ADD FLOW
  if (isAdmin(id) && addState[id]) {

    const st = addState[id];

    if (st.step === "title") {
      st.title = text;
      st.step = "address";
      return bot.sendMessage(id, "Адрес:");
    }

    if (st.step === "address") {
      st.address = text;
      st.step = "price";
      return bot.sendMessage(id, "Цена:");
    }

    if (st.step === "price") {

      const db = loadDB();

      db.properties.push({
        id: Date.now().toString(),
        title: st.title,
        address: st.address,
        price: text
      });

      saveDB(db);

      delete addState[id];

      return bot.sendMessage(id, "Объект добавлен");
    }

  }

  // SEARCH
  const found = searchProperties(text);

  if (found.length) {
    await bot.sendMessage(id, "Нашёл варианты:");
    return showProperty(id, found[0], 0, found.length);
  }

  // PHONE
  const phone = getPhone(text);

  if (phone) {

    const lead =
`📥 НОВАЯ ЗАЯВКА

Телефон: ${phone}
ID: ${id}`;

    try {
      await bot.sendMessage(ADMIN_GROUP, lead);
    } catch (err) {
      console.log("Lead send error:", err.message);
    }

    return bot.sendMessage(id,
"Спасибо! Менеджер свяжется с вами.",
mainKb);
  }

  // AI
  try {

    bot.sendChatAction(id, "typing");

    const reply = await askAI(id, text);

    if (reply) {
      bot.sendMessage(id, reply, mainKb);
    } else {
      bot.sendMessage(id,
        "Напишите ваш номер телефона и менеджер свяжется с вами.",
        contactKb
      );
    }

  } catch (err) {

    console.log("BOT ERROR:", err.message);

    bot.sendMessage(id,
      "Напишите номер телефона и менеджер свяжется с вами.",
      contactKb
    );

  }

});

// CALLBACK
bot.on("callback_query", async q => {

  const db = loadDB();
  const id = q.message.chat.id;

  if (q.data === "noop") return;

  if (q.data.startsWith("prop:")) {

    const idx = Number(q.data.split(":")[1]);

    if (idx < 0 || idx >= db.properties.length) return;

    await bot.deleteMessage(id, q.message.message_id).catch(()=>{});

    await showProperty(id, db.properties[idx], idx, db.properties.length);

  }

});

// CRASH PROTECTION
process.on("uncaughtException", err => {
  console.log("UNCAUGHT:", err);
});

process.on("unhandledRejection", err => {
  console.log("REJECTION:", err);
});

console.log("🚀 РеалИнвест БОТ запущен");
