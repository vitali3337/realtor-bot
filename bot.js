require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");

// ===== ENV =====
const TOKEN = process.env.TELEGRAM_TOKEN;
const AI_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_GROUP = Number(process.env.ADMIN_GROUP);
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",");

const DB_FILE = "./db.json";

if (!TOKEN) {
  console.log("❌ TELEGRAM_TOKEN не найден");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

let ai = null;

if (AI_KEY) {
  ai = new Anthropic({ apiKey: AI_KEY });
}

// ===== DATABASE =====

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

function saveClient(id, type) {
  const db = loadDB();

  db.clients[id] = {
    type,
    date: new Date().toISOString()
  };

  saveDB(db);
}

// ===== PHONE FIX =====

function getPhone(text) {

  if (!text) return null;

  const cleaned = text.replace(/[^\d+]/g, "");

  const match = cleaned.match(/\+?\d{7,15}/);

  return match ? match[0] : null;
}

// ===== KEYBOARDS =====

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["📋 Смотреть объекты", "🏦 Ипотека"],
      ["📄 Документы", "📞 Менеджер"]
    ],
    resize_keyboard: true
  }
};

const phoneKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "📱 Отправить номер", request_contact: true }]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  }
};

// ===== AI PROMPT =====

const SYSTEM = `
Ты помощник агентства недвижимости РеалИнвест.

Город: Тирасполь
Адрес: ул. Восстания 10

Менеджеры:
Сергей 77726536
Александр 77772487
Виталий 77772473

Отвечай коротко и по делу.
`;

// ===== AI =====

async function askAI(text) {

  if (!ai) return null;

  try {

    const res = await ai.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 200,
      system: SYSTEM,
      messages: [
        { role: "user", content: text }
      ]
    });

    return res.content[0].text;

  } catch (err) {

    console.log("AI error:", err.message);
    return null;

  }

}

// ===== START =====

bot.onText(/\/start/, msg => {

  const id = msg.chat.id;

  saveClient(id, "start");

  bot.sendMessage(
    id,
`Здравствуйте!

Добро пожаловать в РеалИнвест.

Продажа недвижимости в Приднестровье.

📍 ул. Восстания 10
☎ 777 26536 / 777 72473

Выберите действие:`,
    mainKeyboard
  );

});

// ===== MENU =====

bot.on("message", async msg => {

  const id = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // КУПИТЬ

  if (text === "🏠 Купить недвижимость") {

    saveClient(id, "buy");

    bot.sendMessage(
      id,
`Напишите:

• район
• количество комнат
• бюджет

Я подберу варианты.`,
      mainKeyboard
    );

    return;

  }

  // ПРОДАТЬ

  if (text === "🏷 Продать недвижимость") {

    saveClient(id, "sell");

    bot.sendMessage(
      id,
`Мы бесплатно оценим недвижимость и найдём покупателя.

Оставьте номер телефона.`,
      phoneKeyboard
    );

    return;

  }

  // ДОКУМЕНТЫ

  if (text === "📄 Документы") {

    bot.sendMessage(
      id,
`Поможем оформить:

• договор купли-продажи
• приватизацию
• наследство
• регистрацию недвижимости`,
      mainKeyboard
    );

    return;

  }

  // ИПОТЕКА

  if (text === "🏦 Ипотека") {

    bot.sendMessage(
      id,
`Поможем оформить ипотеку.

Напишите стоимость объекта и первоначальный взнос.`,
      mainKeyboard
    );

    return;

  }

  // МЕНЕДЖЕР

  if (text === "📞 Менеджер") {

    bot.sendMessage(
      id,
`Наши менеджеры:

Сергей 77726536
Александр 77772487
Виталий 77772473

Оставьте номер телефона.`,
      phoneKeyboard
    );

    return;

  }

  // PHONE TEXT

  const phone = getPhone(text);

  if (phone) {

    bot.sendMessage(
      ADMIN_GROUP,
`📥 Новая заявка

Имя: ${msg.from.first_name}
Телефон: ${phone}
ID: ${msg.from.id}`
    ).catch(()=>{});

    bot.sendMessage(
      id,
"Спасибо! Менеджер скоро свяжется.",
      mainKeyboard
    );

    return;

  }

  // AI

  const reply = await askAI(text);

  if (reply) {

    bot.sendMessage(id, reply, mainKeyboard);

  } else {

    bot.sendMessage(
      id,
"Напишите номер телефона и менеджер свяжется с вами.",
      phoneKeyboard
    );

  }

});

// ===== CONTACT =====

bot.on("contact", msg => {

  const phone = msg.contact.phone_number;

  bot.sendMessage(
    ADMIN_GROUP,
`📥 Новая заявка

Имя: ${msg.from.first_name}
Телефон: ${phone}
ID: ${msg.from.id}`
  ).catch(()=>{});

  bot.sendMessage(
    msg.chat.id,
    "Спасибо! Менеджер скоро свяжется.",
    mainKeyboard
  );

});

// ===== ERRORS =====

bot.on("polling_error", e => {
  console.log("Polling error:", e.message);
});

process.on("uncaughtException", e => {
  console.log("Uncaught:", e);
});

process.on("unhandledRejection", e => {
  console.log("Rejection:", e);
});

bot.on("polling_error", e => {
  console.log("Polling error:", e.message);
});

process.on("uncaughtException", e => {
  console.log("Uncaught:", e);
});

process.on("unhandledRejection", e => {
  console.log("Rejection:", e);
});

console.log("🚀 РеалИнвест бот запущен");

setTimeout(() => {

bot.sendMessage(
ADMIN_GROUP,
"✅ Бот подключен и может отправлять заявки"
).catch(e => console.log(e));

}, 5000);
