require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");

const TOKEN = process.env.TELEGRAM_TOKEN;
const AI_KEY = process.env.ANTHROPIC_API_KEY;

const ADMIN_GROUP = Number(process.env.ADMIN_GROUP) || -1003773163201;

const DB_FILE = "./db.json";

if (!TOKEN) {
console.log("Нет TELEGRAM_TOKEN");
process.exit();
}

const bot = new TelegramBot(TOKEN, { polling: true });

let ai = null;

if (AI_KEY) {
try {
ai = new Anthropic({ apiKey: AI_KEY });
} catch {
ai = null;
}
}

/* ===== DATABASE ===== */

function loadDB() {
try {
return JSON.parse(fs.readFileSync(DB_FILE,"utf8"));
} catch {
return { properties: [], clients: {} };
}
}

function saveDB(db) {
fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2));
}

function saveClient(id,type){
const db = loadDB();

db.clients[id] = {
type,
date: new Date().toISOString()
};

saveDB(db);
}

/* ===== PHONE ===== */

function getPhone(text){

const m = text
.replace(/[^\d+]/g,"")
.match(/+?\d{7,15}/);

return m ? m[0] : null;

}

/* ===== KEYBOARDS ===== */

const mainKb = {
reply_markup:{
keyboard:[
["🏠 Купить недвижимость","🏷 Продать недвижимость"],
["📋 Смотреть объекты","🏦 Ипотека"],
["📄 Документы","📞 Менеджер"]
],
resize_keyboard:true
}
};

const contactKb = {
reply_markup:{
keyboard:[
[{text:"📱 Отправить номер",request_contact:true}],
["🔙 Назад"]
],
resize_keyboard:true
}
};

/* ===== AI ===== */

async function askAI(text){

if(!ai) return null;

try{

const res = await ai.messages.create({
model:"claude-3-haiku-20240307",
max_tokens:150,
messages:[
{
role:"user",
content:text
}
]
});

return res?.content?.[0]?.text || null;

}catch(e){

console.log("AI error:",e.message);
return null;

}

}

/* ===== PROPERTY ===== */

async function showProperty(chatId,prop){

const caption =

`🏠 ${prop.title}

📍 ${prop.address}

💰 ${prop.price}

☎ 77726536 / 77772473
ул. Восстания 10`;

try{

if(prop.photo)
await bot.sendPhoto(chatId,prop.photo,{caption});
else
await bot.sendMessage(chatId,caption);

}catch{

bot.sendMessage(chatId,caption);

}

}

/* ===== START ===== */

bot.onText(//start/,msg=>{

const id = msg.chat.id;
const name = msg.from.first_name || "";

saveClient(id,"start");

bot.sendMessage(

id,

`Здравствуйте${name ? ", "+name : ""}!

Добро пожаловать в РеалИнвест!

Продажа недвижимости в Приднестровье

ул. Восстания 10
777 26536 / 777 72473

Выберите действие:`,

mainKb

);

});

/* ===== BUTTONS ===== */

bot.onText(/Купить недвижимость/,msg=>{

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

bot.onText(/Продать недвижимость/,msg=>{

bot.sendMessage(

msg.chat.id,

`Отправьте адрес и цену объекта.

Менеджер свяжется с вами.`,

contactKb

);

});

bot.onText(/Смотреть объекты/,async msg=>{

const db = loadDB();

if(!db.properties.length)
return bot.sendMessage(msg.chat.id,"Объектов пока нет");

showProperty(msg.chat.id,db.properties[0]);

});

bot.onText(/Ипотека/,msg=>{

bot.sendMessage(

msg.chat.id,

`Мы поможем оформить ипотеку.

Напишите стоимость объекта.`,

mainKb

);

});

bot.onText(/Документы/,msg=>{

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

bot.onText(/Менеджер/,msg=>{

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

bot.on("contact",async msg=>{

const phone = msg.contact.phone_number;

try{

await bot.sendMessage(

ADMIN_GROUP,

`НОВАЯ ЗАЯВКА

Имя: ${msg.from.first_name}
Телефон: ${phone}`

);

}catch{}

bot.sendMessage(msg.chat.id,"Спасибо! Менеджер свяжется.",mainKb);

});

/* ===== MESSAGE ===== */

bot.on("message",async msg=>{

const id = msg.chat.id;
const text = msg.text;

if(!text || text.startsWith("/")) return;

const phone = getPhone(text);

if(phone){

try{

await bot.sendMessage(

ADMIN_GROUP,

`НОВАЯ ЗАЯВКА

Телефон: ${phone}
ID: ${id}`

);

}catch{}

return bot.sendMessage(id,"Спасибо! Менеджер свяжется.",mainKb);

}

try{

bot.sendChatAction(id,"typing");

const reply = await askAI(text);

if(reply){

bot.sendMessage(id,reply,mainKb);

}else{

bot.sendMessage(
id,
"Напишите номер телефона и менеджер свяжется.",
contactKb
);

}

}catch{

bot.sendMessage(
id,
"Напишите номер телефона и менеджер свяжется.",
contactKb
);

}

});

/* ===== START MESSAGE ===== */

setTimeout(()=>{

bot.sendMessage(
ADMIN_GROUP,
"Бот РеалИнвест запущен"
).catch(()=>{});

},3000);

console.log("Бот запущен");
