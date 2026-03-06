require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.TELEGRAM_TOKEN;
const AI_KEY = process.env.ANTHROPIC_API_KEY;

const ADMIN_GROUP = -1003773163201;

const ADMIN_IDS = (process.env.ADMIN_IDS || "5705817827")
.split(",")
.map(x => x.trim());

const DB_FILE = "./db.json";
const SEEN_FILE = "./seen.json";

const CHECK_INTERVAL = 5 * 60 * 1000;

if (!TOKEN) {
console.log("❌ TELEGRAM_TOKEN отсутствует");
process.exit();
}

const bot = new TelegramBot(TOKEN,{ polling:true });

const ai = new Anthropic({ apiKey: AI_KEY });

bot.on("polling_error", console.log);

// ============================================================
// DATABASE
// ============================================================

function loadDB(){

try{
return JSON.parse(fs.readFileSync(DB_FILE));
}catch{
return {properties:[],clients:{}};
}

}

function saveDB(db){
fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2));
}

function loadSeen(){

try{
return JSON.parse(fs.readFileSync(SEEN_FILE));
}catch{
return {};
}

}

function saveSeen(s){
fs.writeFileSync(SEEN_FILE,JSON.stringify(s,null,2));
}

function saveClient(id,type){

const db = loadDB();

db.clients[id] = {
type,
date:new Date().toISOString()
};

saveDB(db);

}

function isAdmin(id){
return ADMIN_IDS.includes(String(id));
}

// ============================================================
// STATE
// ============================================================

const userState = {};
const chatHistory = {};

function getHistory(id){

if(!chatHistory[id]) chatHistory[id]=[];

return chatHistory[id];

}

function pushHistory(id,role,content){

const h=getHistory(id);

h.push({role,content});

if(h.length>20) h.splice(0,2);

}

function getPhone(text){

const m=text.replace(/[^\d+]/g,"").match(/\+?\d{7,15}/);

return m?m[0]:null;

}

// ============================================================
// KEYBOARDS
// ============================================================

const mainKb={
reply_markup:{
keyboard:[
["🏠 Купить недвижимость","🏷 Продать недвижимость"],
["📋 Смотреть объекты","📞 Менеджер"]
],
resize_keyboard:true
}
};

const contactKb={
reply_markup:{
keyboard:[
[{text:"📱 Отправить номер",request_contact:true}]
],
resize_keyboard:true,
one_time_keyboard:true
}
};

// ============================================================
// AI
// ============================================================

const SYSTEM = `
Ты помощник агентства недвижимости РеалИнвест в Тирасполе.

Адрес: ул. Восстания 10
Телефон: 777 26536

Отвечай коротко.
Всегда предлагай оставить номер телефона.
`;

async function askClaude(id,text){

pushHistory(id,"user",text);

const res = await ai.messages.create({

model:"claude-3-5-sonnet-20241022",

max_tokens:300,

system:SYSTEM,

messages:getHistory(id)

});

const reply=res.content[0].text;

pushHistory(id,"assistant",reply);

return reply;

}

// ============================================================
// PROPERTY
// ============================================================

async function showProperty(chatId,prop){

const text=

`🏠 ${prop.title}

📍 ${prop.address}

💰 ${prop.price}

📞 77726536`;

if(prop.photo){

await bot.sendPhoto(chatId,prop.photo,{caption:text});

}else{

await bot.sendMessage(chatId,text);

}

}

// ============================================================
// LEAD
// ============================================================

async function sendLead(msg,phone){

const u=userState[msg.chat.id]||{};

const text=

`📥 НОВАЯ ЗАЯВКА

Тип: ${u.type||"Покупка"}

Имя: ${msg.from.first_name}

Username: @${msg.from.username||"нет"}

Телефон: ${phone}`;

await bot.sendMessage(ADMIN_GROUP,text);

}

async function confirmLead(chatId,msg,phone){

await sendLead(msg,phone);

delete userState[chatId];

chatHistory[chatId]=[];

saveClient(chatId,"lead");

bot.sendMessage(chatId,
"Спасибо! Менеджер свяжется с вами.",
mainKb);

}

// ============================================================
// MAKLER
// ============================================================

const MAKLER_URLS=[

"https://makler.md/tiraspol/real-estate/real-estate-for-sale/apartments-for-sale/",

"https://makler.md/tiraspol/real-estate/real-estate-for-sale/houses-for-sale/"

];

async function parseMakler(){

const ads=[];

for(const url of MAKLER_URLS){

try{

const {data}=await axios.get(url,{
headers:{ "User-Agent":"Mozilla/5.0"}
});

const $=cheerio.load(data);

$("a[href*='/an/']").each((i,el)=>{

const href=$(el).attr("href");
const title=$(el).text().trim();

if(!href) return;

if(title.length<10) return;

const low=title.toLowerCase();

if(
low.includes("агентство")||
low.includes("риелтор")||
low.includes("агент")
){
return;
}

const link="https://makler.md"+href;

ads.push({
id:link,
title,
link
});

});

}catch(e){

console.log("Makler error");

}

}

return ads;

}

async function checkMakler(){

console.log("Makler check");

const seen=loadSeen();

const ads=await parseMakler();

for(const ad of ads){

if(!seen[ad.id]){

seen[ad.id]=true;

await bot.sendMessage(
ADMIN_GROUP,
`🔥 Новый объект

${ad.title}

${ad.link}`
);

}

}

saveSeen(seen);

}

// ============================================================
// COMMANDS
// ============================================================

bot.onText(/\/start/,msg=>{

const id=msg.chat.id;

userState[id]={};

chatHistory[id]=[];

saveClient(id,"start");

bot.sendMessage(id,
`Здравствуйте!

Агентство РеалИнвест

📞 77726536`,
mainKb);

});

bot.on("contact",async msg=>{

const id=msg.chat.id;

const phone=msg.contact.phone_number;

await confirmLead(id,msg,phone);

});

// ============================================================
// MESSAGE
// ============================================================

bot.on("message",async msg=>{

const id=msg.chat.id;
const text=msg.text;

if(!text) return;

if(text==="📋 Смотреть объекты"){

const db=loadDB();

if(!db.properties.length){

return bot.sendMessage(id,"Сейчас объектов нет");

}

return showProperty(id,db.properties[0]);

}

if(text==="🏠 Купить недвижимость"){

userState[id]={type:"Покупка"};

return bot.sendMessage(id,
"Напишите район и бюджет");

}

if(text==="🏷 Продать недвижимость"){

userState[id]={type:"Продажа"};

return bot.sendMessage(id,
"Отправьте номер телефона",
contactKb);

}

if(text==="📞 Менеджер"){

return bot.sendMessage(id,
"Нажмите кнопку чтобы отправить номер",
contactKb);

}

const phone=getPhone(text);

if(phone){

return confirmLead(id,msg,phone);

}

try{

const reply=await askClaude(id,text);

bot.sendMessage(id,reply);

}catch{

bot.sendMessage(id,
"Напишите номер телефона и менеджер свяжется.");

}

});

// ============================================================
// START
// ============================================================

async function start(){

console.log("🚀 BOT STARTED");

await checkMakler();

setInterval(checkMakler,CHECK_INTERVAL);

}

start();    
