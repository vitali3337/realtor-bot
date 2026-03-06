require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");

const TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const ADMIN_GROUP = -1003773163201;

const DB_FILE = "./properties.json";
const SEEN_FILE = "./seen_ads.json";

const CHECK_INTERVAL = 5 * 60 * 1000;

if (!TOKEN) {
  console.log("Нет TELEGRAM_TOKEN");
  process.exit();
}

const bot = new TelegramBot(TOKEN, { polling: true });

const claude = new Anthropic({
  apiKey: ANTHROPIC_KEY
});

bot.on("polling_error", console.log);

const users = {};
const history = {};

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

function loadSeen() {
  try {
    return JSON.parse(fs.readFileSync(SEEN_FILE));
  } catch {
    return {};
  }
}

function saveSeen(s) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(s, null, 2));
}

function saveClient(id, type) {
  const db = loadDB();
  db.clients[id] = {
    type,
    date: new Date().toISOString()
  };
  saveDB(db);
}

function phoneFromText(text) {
  const t = text.replace(/[^\d+]/g, "");
  const m = t.match(/\+?\d{7,15}/);
  return m ? m[0] : null;
}

const mainKb = {
  reply_markup: {
    keyboard: [
      ["🏠 Купить недвижимость", "🏷 Продать недвижимость"],
      ["📋 Смотреть объекты", "📞 Связаться с менеджером"]
    ],
    resize_keyboard: true
  }
};

const contactKb = {
  reply_markup: {
    keyboard: [
      [{ text: "📱 Отправить мой номер", request_contact: true }]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  }
};

async function askClaude(chatId, text) {

  if (!history[chatId]) history[chatId] = [];

  history[chatId].push({
    role: "user",
    content: text
  });

  const res = await claude.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 300,
    system: "Ты помощник агентства недвижимости РеалИнвест. Отвечай коротко.",
    messages: history[chatId]
  });

  const reply = res.content[0].text;

  history[chatId].push({
    role: "assistant",
    content: reply
  });

  return reply;
}

async function sendLead(msg, phone) {

  const text =
`📥 НОВАЯ ЗАЯВКА

Имя: ${msg.from.first_name}
Username: @${msg.from.username || "нет"}

Телефон: ${phone}`;

  await bot.sendMessage(ADMIN_GROUP, text);
}

async function showProperty(chatId, prop) {

  const text =
`🏠 ${prop.title}

📍 ${prop.address}

💰 ${prop.price}

📞 77726536`;

  if (prop.photo) {

    await bot.sendPhoto(chatId, prop.photo, {
      caption: text
    });

  } else {

    await bot.sendMessage(chatId, text);

  }

}

const MAKLER_URLS = [
"https://makler.md/tiraspol/real-estate/real-estate-for-sale/apartments-for-sale/",
"https://makler.md/tiraspol/real-estate/real-estate-for-sale/houses-for-sale/"
];

async function parseMakler() {

  const ads = [];

  for (const url of MAKLER_URLS) {

    try {

      const { data } = await axios.get(url);

      const $ = cheerio.load(data);

      $("a[href*='/an/']").each((i, el) => {

        const href = $(el).attr("href");
        const title = $(el).text().trim();

        if (!href || title.length < 5) return;

        const link = "https://makler.md" + href;

        ads.push({
          id: link,
          title,
          link
        });

      });

    } catch {}

  }

  return ads;

}

async function checkMakler() {

  const seen = loadSeen();

  const ads = await parseMakler();

  for (const ad of ads) {

    if (!seen[ad.id]) {

      seen[ad.id] = true;

      const msg =
`🔥 Новый объект Makler

${ad.title}

${ad.link}`;

      await bot.sendMessage(ADMIN_GROUP, msg);

    }

  }

  saveSeen(seen);

}

bot.onText(/\/start/, msg => {

  const id = msg.chat.id;

  users[id] = {};

  saveClient(id, "start");

  bot.sendMessage(id,
`Здравствуйте!

Агентство РеалИнвест.

Выберите действие`,
  mainKb);

});

bot.on("contact", async msg => {

  const id = msg.chat.id;

  const phone = msg.contact.phone_number;

  await sendLead(msg, phone);

  bot.sendMessage(id,
`Спасибо! Менеджер свяжется с вами.`,
  mainKb);

});

bot.on("message", async msg => {

  const id = msg.chat.id;

  const text = msg.text;

  if (!text) return;

  if (text === "📋 Смотреть объекты") {

    const db = loadDB();

    if (!db.properties.length) {

      return bot.sendMessage(id, "Объекты скоро появятся");

    }

    return showProperty(id, db.properties[0]);

  }

  if (text === "🏠 Купить недвижимость") {

    users[id] = { type: "buy" };

    return bot.sendMessage(id,
"Напишите район и бюджет.",
mainKb);

  }

  if (text === "🏷 Продать недвижимость") {

    users[id] = { type: "sell" };

    return bot.sendMessage(id,
"Отправьте номер телефона.",
contactKb);

  }

  if (text === "📞 Связаться с менеджером") {

    return bot.sendMessage(id,
"Нажмите кнопку чтобы отправить номер.",
contactKb);

  }

  const phone = phoneFromText(text);

  if (phone) {

    await sendLead(msg, phone);

    return bot.sendMessage(id,
"Спасибо. Менеджер скоро позвонит.",
mainKb);

  }

  try {

    const reply = await askClaude(id, text);

    bot.sendMessage(id, reply);

  } catch {

    bot.sendMessage(id,
"Ошибка. Попробуйте позже.");

  }

});

(async () => {

  await checkMakler();

  setInterval(checkMakler, CHECK_INTERVAL);

  console.log("BOT STARTED");

})();
