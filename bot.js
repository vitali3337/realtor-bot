  require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");

/* ===== CONFIG ===== */

const TOKEN = process.env.TELEGRAM_TOKEN;
const AI_KEY = process.env.ANTHROPIC_API_KEY;

const ADMIN_GROUP = Number(process.env.ADMIN_GROUP) || -1003773163201;
const ADMIN_IDS = (process.env.ADMIN_IDS || "5705817827").split(",");

const DB_FILE = "./db.json";

if (!TOKEN) {
console.log("❌ TELEGRAM_TOKEN отсутствует");
process.exit();
}

const bot = new TelegramBot(TOKEN, { polling: true });

let ai = null;
if (AI_KEY) ai = new Anthropic({ apiKey: AI_KEY });

bot.on("polling_error", e => console.log("Polling error:", e.message));

/* ===== DATABASE ===== */

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
db.clients[id] = { type, date: new Date().toISOString() };
saveDB(db);
}

function isAdmin(id) {
return ADMIN_IDS.includes(String(id));
}

/* ===== HISTORY ===== */

const history = {};

function pushHistory(id, role, text) {
if (!history[id]) history[id] = [];
history[id].push({ role, content: text });

if (history[id].length > 10) history[id].shift();
}

/* ===== AI ===== */

const SYSTEM = `
Ты помощник агентства недвижимости РеалИнвест.

Город: Тирасполь
Адрес: ул. Восстания 10

Менеджеры:
Сергей 77726536
Александр 77772487
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

const reply = res?.content?.[0]?.text || null;

if (reply) pushHistory(id, "assistant", reply);

return reply;

} catch (err) {

console.log("AI error:", err.message);
return null;

}

}

/* ===== PHONE ===== */

function getPhone(text) {
const m = text.replace(/[^\d+]/g, "").match(/+?\d{7,15}/);
return m ? m[0] : null;
}

/* ===== STATES ===== */

const userState = {};

/* ===== KEYBOARDS ===== */

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
[{ text: "📱 Отправить номер", request_contact: true }],
["🔙 Назад"]
],
resize_keyboard: true
}
};

/* ===== PROPERTY SHOW ===== */

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

/* ===== START ===== */

bot.onText(//start/, msg => {

const id = msg.chat.id;
const name = msg.from.first_name || "";

history[id] = {};
userState[id] = {};

saveClient(id, "start");

bot.sendMessage(
id,
`Здравствуйте${name ? ", " + name : ""}!

Добро пожаловать в РеалИнвест!

Продажа недвижимости в Приднестровье

ул. Восстания 10
777 26536 / 777 72473

Выберите действие:`,
mainKb
);

});

/* ===== BUTTONS ===== */

bot.onText(/🏠 Купить недвижимость/, msg => {

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

bot.onText(/🏷 Продать недвижимость/, msg => {

userState[msg.chat.id] = { type: "sell" };

bot.sendMessage(
msg.chat.id,
`Отправьте адрес и цену объекта.

Менеджер свяжется с вами.`,
contactKb
);

});

bot.onText(/📋 Смотреть объекты/, async msg => {

const db = loadDB();

if (!db.properties.length)
return bot.sendMessage(msg.chat.id,"Объектов пока нет");

await showProperty(msg.chat.id, db.properties[0], 0, db.properties.length);

});

bot.onText(/🏦 Ипотека/, msg => {

bot.sendMessage(
msg.chat.id,
`Поможем оформить ипотеку.

Напишите стоимость объекта и первоначальный взнос.`,
mainKb
);

});

bot.onText(/📄 Документы/, msg => {

bot.sendMessage(
msg.chat.id,
`Поможем оформить:

• договор купли-продажи
• приватизацию
• наследство
• регистрацию недвижимости`,
mainKb
);

});

bot.onText(/📞 Менеджер/, msg => {

bot.sendMessage(
msg.chat.id,
`Менеджеры РеалИнвест:

Сергей 77726536
Александр 77772487
Виталий 77772473`,
contactKb
);

});

/* ===== CONTACT ===== */

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
"Спасибо! Менеджер скоро свяжется.",
mainKb);

});

/* ===== MESSAGE ===== */

bot.on("message", async msg => {

const id = msg.chat.id;
const text = msg.text;

if (!text || text.startsWith("/")) return;

const phone = getPhone(text);

if (phone) {

const lead =

`📥 НОВАЯ ЗАЯВКА

Телефон: ${phone}
ID: ${id}`;

try {
  await bot.sendMessage(ADMIN_GROUP, lead);
} catch (err) {
  console.log("Lead error:", err.message);
}

return bot.sendMessage(id,

"Спасибо! Менеджер свяжется с вами.",
mainKb);

}

try {

bot.sendChatAction(id, "typing");

let reply = null;

try {
  reply = await askAI(id, text);
} catch {}

if (reply) {
  bot.sendMessage(id, reply, mainKb);
} else {
  bot.sendMessage(
    id,
    "Напишите ваш номер телефона и менеджер свяжется с вами.",
    contactKb
  );
}

} catch (err) {

console.log("BOT error:", err.message);

}

});

/* ===== CALLBACK ===== */

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

/* ===== START MESSAGE ===== */

setTimeout(()=>{

bot.sendMessage(
ADMIN_GROUP,
"🚀 РеалИнвест бот запущен"
).catch(()=>{});

},3000);

console.log("🚀 РеалИнвест БОТ запущен");
