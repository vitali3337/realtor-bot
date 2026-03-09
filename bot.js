require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");

// =======================
// ENV
// =======================

const TOKEN = process.env.TELEGRAM_TOKEN;
const AI_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_GROUP = Number(process.env.ADMIN_GROUP) || -1003773163201;
const ADMIN_IDS = (process.env.ADMIN_IDS || "5705817827").split(",");

if (!TOKEN) {
  console.log("❌ Нет TELEGRAM_TOKEN");
  process.exit();
}

const bot = new TelegramBot(TOKEN, { polling: true });

let ai = null;
if (AI_KEY) {
  ai = new Anthropic({ apiKey: AI_KEY });
}

// =======================
// DATABASE
// =======================

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

function saveClient(id) {
  const db = loadDB();

  db.clients[id] = {
    date: new Date().toISOString()
  };

  saveDB(db);
}

// =======================
// KEYBOARDS
// =======================

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

// =======================
// AI
// =======================

const history = {};

function pushHistory(id, role, text) {
  if (!history[id]) history[id] = [];

  history[id].push({
    role,
    content: text
  });

  if (history[id].length > 10) history[id].shift();
}

const SYSTEM = `
Ты помощник агентства недвижимости РеалИнвест.

Город: Тирасполь
Адрес: ул. Восстания 10

Менеджеры:
Сергей 77726536
Виталий 77772473

Отвечай коротко.
`;

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

    const reply = res?.content?.[0]?.text;

    if (reply) {
      pushHistory(id, "assistant", reply);
    }

    return reply;

  } catch (err) {
    console.log("AI error:", err.message);
    return null;
  }

}

// =======================
// PROPERTY
// =======================

async function showProperty(chatId, prop) {

  const caption =
`🏠 ${prop.title}

📍 ${prop.address}

💰 ${prop.price}

☎ 77726536
ул. Восстания 10`;

  if (prop.photo)
    bot.sendPhoto(chatId, prop.photo, { caption });
  else
    bot.sendMessage(chatId, caption);

}

// =======================
// START
// =======================

bot.onText(/\/start/, msg => {

  const id = msg.chat.id;

  saveClient(id);

  bot.sendMessage(
    id,
`Добро пожаловать в РеалИнвест 🏠

Продажа недвижимости в Тирасполе

Выберите действие:`,
    mainKb
  );

});

// =======================
// BUTTONS
// =======================

bot.onText(/🏠 Купить/, msg => {

  bot.sendMessage(
    msg.chat.id,
`Напишите:

• район
• количество комнат
• бюджет

Я подберу варианты.`,
    mainKb
  );

});

bot.onText(/🏷 Продать/, msg => {

  bot.sendMessage(
    msg.chat.id,
`Отправьте:

• адрес
• цену
• фото

Менеджер свяжется с вами.`,
    contactKb
  );

});

bot.onText(/📞 Менеджер/, msg => {

  bot.sendMessage(
    msg.chat.id,
`Связь с менеджером:

Сергей
📞 77726536

Виталий
📞 77772473`,
    mainKb
  );

});

bot.onText(/🏦 Ипотека/, msg => {

  bot.sendMessage(
    msg.chat.id,
`Мы помогаем оформить ипотеку.

Отправьте номер телефона.`,
    contactKb
  );

});

// =======================
// SHOW OBJECTS
// =======================

bot.onText(/📋 Объекты/, msg => {

  const db = loadDB();

  if (!db.properties.length)
    return bot.sendMessage(msg.chat.id, "Объектов пока нет");

  showProperty(msg.chat.id, db.properties[0]);

});

// =======================
// CONTACT
// =======================

bot.on("contact", async msg => {

  const phone = msg.contact.phone_number;

  const text =
`📥 НОВАЯ ЗАЯВКА

Имя: ${msg.from.first_name}
Телефон: ${phone}
ID: ${msg.from.id}`;

  try {
    await bot.sendMessage(ADMIN_GROUP, text);
  } catch {}

  bot.sendMessage(
    msg.chat.id,
"Спасибо! Менеджер скоро свяжется.",
mainKb
  );

});

// =======================
// ADD PROPERTY
// =======================

const addState = {};

bot.onText(/\/add/, msg => {

  if (!ADMIN_IDS.includes(String(msg.chat.id))) return;

  addState[msg.chat.id] = { step: "title" };

  bot.sendMessage(msg.chat.id, "Название объекта:");

});

bot.on("message", async msg => {

  const id = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // ADD PROPERTY FLOW
  if (addState[id]) {

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

  // AI
  const reply = await askAI(id, text);

  if (reply) {
    bot.sendMessage(id, reply, mainKb);
  }

});

// =======================

console.log("🚀 РеалИнвест бот запущен");
