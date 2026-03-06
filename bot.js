require("dotenv").config()

const TelegramBot = require("node-telegram-bot-api")
const Anthropic = require("@anthropic-ai/sdk")
const axios = require("axios")
const cheerio = require("cheerio")
const fs = require("fs")

// CONFIG

const TOKEN = process.env.TELEGRAM_TOKEN
const AI_KEY = process.env.ANTHROPIC_API_KEY

const ADMIN_GROUP = -1003773163201

const DB_FILE = "./db.json"
const SEEN_FILE = "./seen.json"

const CHECK_INTERVAL = 5 * 60 * 1000

if (!TOKEN) {
console.log("TELEGRAM_TOKEN missing")
process.exit()
}

const bot = new TelegramBot(TOKEN,{ polling:true })

let ai = null

if (AI_KEY){
ai = new Anthropic({ apiKey: AI_KEY })
}

// MEMORY

let users = {}
let history = {}

// DATABASE

function loadDB(){

try{
return JSON.parse(fs.readFileSync(DB_FILE))
}catch{
return {properties:[],clients:{}}
}

}

function saveDB(db){

fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2))

}

function loadSeen(){

try{
return JSON.parse(fs.readFileSync(SEEN_FILE))
}catch{
return {}
}

}

function saveSeen(data){

fs.writeFileSync(SEEN_FILE,JSON.stringify(data,null,2))

}

// CLIENT SAVE

function saveClient(id,type){

const db = loadDB()

db.clients[id] = {
type,
date:new Date().toISOString()
}

saveDB(db)

}

// PHONE PARSER

function extractPhone(text){

const clean=text.replace(/[^\d+]/g,"")

const m=clean.match(/\+?\d{7,15}/)

return m ? m[0] : null

}

// KEYBOARDS

const mainKb={
reply_markup:{
keyboard:[
["🏠 Купить","🏷 Продать"],
["📋 Смотреть объекты","📞 Менеджер"]
],
resize_keyboard:true
}
}

const contactKb={
reply_markup:{
keyboard:[
[{text:"📱 Отправить номер",request_contact:true}]
],
resize_keyboard:true,
one_time_keyboard:true
}
}

// AI RESPONSE

async function askAI(chatId,text){

if(!ai) return "Напишите номер телефона и менеджер свяжется."

if(!history[chatId]) history[chatId]=[]

history[chatId].push({
role:"user",
content:text
})

const res = await ai.messages.create({

model:"claude-3-5-sonnet-20241022",

max_tokens:300,

system:"Ты помощник агентства недвижимости РеалИнвест в Тирасполе. Отвечай коротко.",

messages:history[chatId]

})

const reply=res.content[0].text

history[chatId].push({
role:"assistant",
content:reply
})

return reply

}

// PROPERTY SHOW

async function showProperty(chatId,prop){

const text=

`🏠 ${prop.title}

📍 ${prop.address}

💰 ${prop.price}

📞 77726536`

if(prop.photo){

await bot.sendPhoto(chatId,prop.photo,{caption:text})

}else{

await bot.sendMessage(chatId,text)

}

}

// SEND LEAD

async function sendLead(msg,phone){

const text=

`📥 НОВАЯ ЗАЯВКА

Имя: ${msg.from.first_name}

Username: @${msg.from.username || "нет"}

Телефон: ${phone}`

await bot.sendMessage(ADMIN_GROUP,text)

}

// MAKLER PARSER

const URLS=[

"https://makler.md/tiraspol/real-estate/real-estate-for-sale/apartments-for-sale/",

"https://makler.md/tiraspol/real-estate/real-estate-for-sale/houses-for-sale/"

]

async function parseMakler(){

const ads=[]

for(const url of URLS){

try{

const {data}=await axios.get(url,{
headers:{ "User-Agent":"Mozilla/5.0"}
})

const $=cheerio.load(data)

$("a[href*='/an/']").each((i,el)=>{

const href=$(el).attr("href")
const title=$(el).text().trim()

if(!href) return

if(
href.includes("add")||
href.includes("notepad")||
href.includes("category")||
href.includes("edit")||
href.includes("web")
){
return
}

if(title.length<15) return

const link="https://makler.md"+href

ads.push({
id:link,
title,
link
})

})

}catch(e){

console.log("Makler parse error")

}

}

return ads

}

// MAKLER CHECK

async function checkMakler(){

console.log("Makler check")

const seen=loadSeen()

const ads=await parseMakler()

for(const ad of ads){

if(!seen[ad.id]){

seen[ad.id]=true

await bot.sendMessage(

ADMIN_GROUP,

`🔥 Новый собственник

🏠 ${ad.title}

🔗 ${ad.link}`

)

}

}

saveSeen(seen)

}

// START

bot.onText(/\/start/,msg=>{

const id=msg.chat.id

users[id]={}

saveClient(id,"start")

bot.sendMessage(id,

`👋 Добро пожаловать!

Агентство недвижимости РеалИнвест

📍 Тирасполь
📞 77726536

Выберите действие`,

mainKb)

})

// CONTACT

bot.on("contact",async msg=>{

const id=msg.chat.id

const phone=msg.contact.phone_number

await sendLead(msg,phone)

bot.sendMessage(id,

"Спасибо! Менеджер скоро свяжется.",

mainKb)

})

// MESSAGE

bot.on("message",async msg=>{

const id=msg.chat.id

const text=msg.text

if(!text) return

if(text==="📋 Смотреть объекты"){

const db=loadDB()

if(!db.properties.length){

return bot.sendMessage(id,"Сейчас объектов нет")

}

return showProperty(id,db.properties[0])

}

if(text==="🏠 Купить"){

users[id]={type:"buy"}

return bot.sendMessage(id,

"Напишите район и бюджет")

}

if(text==="🏷 Продать"){

users[id]={type:"sell"}

return bot.sendMessage(id,

"Отправьте номер телефона",

contactKb)

}

if(text==="📞 Менеджер"){

return bot.sendMessage(id,

"Нажмите кнопку чтобы отправить номер",

contactKb)

}

const phone=extractPhone(text)

if(phone){

await sendLead(msg,phone)

return bot.sendMessage(id,

"Спасибо. Менеджер скоро позвонит",

mainKb)

}

try{

const reply=await askAI(id,text)

bot.sendMessage(id,reply)

}catch{

bot.sendMessage(id,"Ошибка сервера")

}

})

// SYSTEM START

async function startSystem(){

console.log("BOT STARTED")

await checkMakler()

setInterval(checkMakler,CHECK_INTERVAL)

}

startSystem()
