require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Anthropic   = require("@anthropic-ai/sdk");
const fs          = require("fs");
const axios       = require("axios");
const cheerio     = require("cheerio");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const ADMIN_ID       = -1003773163201;
const ADMIN_IDS      = (process.env.ADMIN_IDS || "5705817827").split(",").map(x => x.trim());
const DB_FILE        = "./properties.json";
const SEEN_FILE      = "./seen_ads.json";
const CHECK_INTERVAL = 5 * 60 * 1000;

if (!TELEGRAM_TOKEN) { console.error("TELEGRAM_TOKEN not found"); process.exit(1); }
if (!ANTHROPIC_KEY)  { console.error("ANTHROPIC_API_KEY not found"); process.exit(1); }

const bot    = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

bot.on("polling_error", (e) => console.log("Polling error:", e.message));

const SYSTEM_PROMPT = "Ty vezhliyy pomoshchnik agentstva nedvizhimosti Real Invest v Tiraspole. Adres: ul. Vosstaniya 10. Menedzhery: Sergey (777 26536), Aleksandr (777 72487), Vitaliy (777 72473). Zanimaemsya tolko prodazhey nedvizhimosti v Pridnestrovye. Otvechay kratko, 2-3 predlozheniya. Kogda klient gotov - popros nazhaty knopku otpravki nomera. Tolko russkiy yazyk.";

const users = {};
const conversations = {};
const adminStates = {};

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { properties: [], clients: {} }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function loadSeen() {
  try { return JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")); }
  catch { return {}; }
}
function saveSeen(s) { fs.writeFileSync(SEEN_FILE, JSON.stringify(s, null, 2)); }
function isAdmin(id) { return ADMIN_IDS.includes(String(id)); }
function getHistory(chatId) {
  if (!conversations[chatId]) conversations[chatId] = [];
  return conversations[chatId];
}
function addToHistory(chatId, role, content) {
  const h = getHistory(chatId);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
}
function saveClient(chatId, type) {
  const db = loadDB();
  if (!db.clients) db.clients = {};
  db.clients[chatId] = { type, date: new Date().toISOString() };
  saveDB(db);
}
function extractPhone(text) {
  const d = text.replace(/[^\d+]/g, "");
  const m = d.match(/\+?[\d]{7,15}/);
  return m ? m[0] : null;
}

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ["Купить недвижимость", "Продать недвижимость"],
      ["Сдать недвижимость",  "Снять недвижимость"],
      ["Смотреть объекты",    "Рассчитать ипотеку"],
      ["Документы",           "Связаться с менеджером"]
    ],
    resize_keyboard: true
  }
};

const contactKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "Отправить мой номер", request_contact: true }],
      ["Назад"]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  }
};

const MAKLER_URLS = [
  { url: "https://makler.md/tiraspol/real-estate/real-estate-for-sale/apartments-for-sale/", city: "Tiraspol", type: "Kvartira" },
  { url: "https://makler.md/tiraspol/real-estate/real-estate-for-sale/houses-for-sale/",     city: "Tiraspol", type: "Dom" },
  { url: "https://makler.md/bender/real-estate/real-estate-for-sale/apartments-for-sale/",   city: "Bendery",  type: "Kvartira" },
  { url: "https://makler.md/bender/real-estate/real-estate-for-sale/houses-for-sale/",       city: "Bendery",  type: "Dom" },
];

async function parseMakler() {
  const ads = [];
  for (const item of MAKLER_URLS) {
    try {
      const { data } = await axios.get(item.url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        timeout: 15000
      });
      const $ = cheerio.load(data);
      $("a[href*='/an/']").each((i, el) => {
        const href  = $(el).attr("href") || "";
        const title = $(el).text().trim();
        if (!href || title.length < 5) return;
        const parent = $(el).closest("div, li, article");
        const price  = parent.find("[class*='price']").first().text().trim();
        const phone  = parent.find("[class*='phone']").first().text().trim();
        const fullLink = href.startsWith("http") ? href : "https://makler.md" + href;
        ads.push({
          id: fullLink, title: title.substring(0, 100),
          price: price || "Cena ne ukazana",
          phone: phone || "Smotri na sayte",
          link: fullLink, city: item.city, type: item.type
        });
      });
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) { console.error("Parser error:", e.message); }
  }
  return ads;
}

async function checkNewAds() {
  console.log("Checking Makler...");
  const seen = loadSeen();
  const isFirst = Object.keys(seen).length === 0;
  const ads = await parseMakler();
  let newCount = 0;
  for (const ad of ads) {
    if (!seen[ad.id]) {
      seen[ad.id] = true;
      newCount++;
      if (!isFirst) {
        try {
          const msg =
            "*Novyy obekt na Makler!*\n\n" +
            "Gorod: " + ad.city + "\n" +
            "Tip: " + ad.type + "\n" +
            ad.title + "\n" +
            "Cena: " + ad.price + "\n" +
            "Tel: " + ad.phone + "\n\n" +
            ad.link + "\n\n" +
            "Pozvonih pervym - predlozhi uslugi RealInvest!";
          await bot.sendMessage(ADMIN_ID, msg, {
            reply_markup: { inline_keyboard: [[{ text: "Otkryt obyavlenie", url: ad.link }]] }
          });
          await new Promise(r => setTimeout(r, 1500));
        } catch (e) { console.error("Send error:", e.message); }
      }
    }
  }
  saveSeen(seen);
  if (isFirst) {
    console.log("Makler base collected:", ads.length);
    try {
      await bot.sendMessage(ADMIN_ID,
        "Monitoring Makler zapushchen!\n\n" +
        "Zapomnil " + ads.length + " obyavleniy\n" +
        "Proveryayu kazhdye 5 minut\n\n" +
        "Slezhu za Tiraspolem i Benderami"
      );
    } catch {}
  }
}

async function showProperty(chatId, property, index, total) {
  const caption =
    "*" + property.title + "*\n\n" +
    "Adres: " + property.address + "\n" +
    "Cena: " + property.price + "\n" +
    (property.rooms ? "Komnat: " + property.rooms + "\n" : "") +
    (property.area  ? "Ploshchad: " + property.area + "\n" : "") +
    (property.floor ? "Etazh: " + property.floor + "\n" : "") +
    (property.description ? "\n" + property.description + "\n" : "") +
    "\n---\n" +
    "Tel: 777 26536 / 777 72473\n" +
    "ul. Vosstaniya 10";

  const nav = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Hochu posmotret - ostavit nomer", callback_data: "want_" + property.id }],
        [
          { text: index > 0       ? "<< Pred" : " ", callback_data: index > 0       ? "prop_" + (index-1) : "noop" },
          { text: (index+1) + "/" + total,             callback_data: "noop" },
          { text: index < total-1 ? "Sled >>" : " ", callback_data: index < total-1 ? "prop_" + (index+1) : "noop" }
        ]
      ]
    }
  };

  try {
    if (property.photo) {
      await bot.sendPhoto(chatId, property.photo, { caption, parse_mode: "Markdown", ...nav });
    } else {
      await bot.sendMessage(chatId, caption, { parse_mode: "Markdown", ...nav });
    }
  } catch {
    await bot.sendMessage(chatId, caption, { parse_mode: "Markdown", ...nav });
  }
}

async function askClaude(chatId, userMessage) {
  addToHistory(chatId, "user", userMessage);
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: getHistory(chatId),
  });
  const reply = response.content[0].text || "Net otveta.";
  addToHistory(chatId, "assistant", reply);
  return reply;
}

async function sendLead(msg, phone, propTitle) {
  const u = users[msg.chat.id] || {};
  try {
    await bot.sendMessage(ADMIN_ID,
      "*NOVAYA ZAYAVKA - RealInvest*\n\n" +
      "Tip: " + (u.type || "Pokupka") + "\n" +
      (propTitle ? "Obekt: " + propTitle + "\n" : "") +
      "Imya: " + (msg.from.first_name || "-") + " " + (msg.from.last_name || "") + "\n" +
      "Username: @" + (msg.from.username || "net") + "\n" +
      "ID: " + msg.from.id + "\n" +
      "Telefon: " + phone + "\n\n" +
      "Menedzhery:\n" +
      "Sergey: 777 26536\n" +
      "Aleksandr: 777 72487\n" +
      "Vitaliy: 777 72473\n" +
      "ul. Vosstaniya 10",
      { parse_mode: "Markdown" }
    );
  } catch (e) { console.error("Lead error:", e.message); }
}

async function confirmLead(chatId, msg, phone, propTitle) {
  await sendLead(msg, phone, propTitle);
  delete users[chatId];
  conversations[chatId] = [];
  saveClient(chatId, "zayavka");
  await bot.sendMessage(chatId,
    "Spasibo! Zayavka prinyata.\n\nMenedzher svyazhetsya s vami.\n\nul. Vosstaniya 10, Tiraspol\n777 26536 / 777 72473",
    mainKeyboard
  );
}

bot.onText(/\/start/, (msg) => {
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];
  saveClient(msg.chat.id, "novyy");
  const name = msg.from.first_name || "";
  bot.sendMessage(msg.chat.id,
    "Zdravstvuyte" + (name ? ", " + name : "") + "!\n\n" +
    "Dobro pozhalovat v RealInvest!\n\n" +
    "Prodazha nedvizhimosti v Pridnestrovye.\n\n" +
    "ul. Vosstaniya 10, Tiraspol\n" +
    "777 26536 / 777 72473\n\n" +
    "Vyberite deystvie:",
    mainKeyboard
  );
});

bot.onText(/\/clear/, (msg) => {
  users[msg.chat.id] = {};
  conversations[msg.chat.id] = [];
  bot.sendMessage(msg.chat.id, "Nachnem snachala!", mainKeyboard);
});

bot.onText(/\/add/, (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  adminStates[msg.chat.id] = { step: "photo" };
  bot.sendMessage(msg.chat.id, "Dobavlenie obekta\n\nShag 1/6: Otprav foto\n(ili /skip)");
});

bot.onText(/\/list/, (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  if (!db.properties.length) return bot.sendMessage(msg.chat.id, "Obektov net. Dobavь cherez /add");
  let text = "Obekty (" + db.properties.length + "):\n\n";
  db.properties.forEach((p, i) => { text += (i+1) + ". " + p.title + " - " + p.price + "\n"; });
  text += "\nUdalit: /delete nomer";
  bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/delete (.+)/, (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const db  = loadDB();
  const idx = parseInt(match[1]) - 1;
  if (idx < 0 || idx >= db.properties.length) return bot.sendMessage(msg.chat.id, "Nevernyy nomer");
  const removed = db.properties.splice(idx, 1)[0];
  saveDB(db);
  bot.sendMessage(msg.chat.id, "Udaleno: " + removed.title);
});

bot.onText(/\/broadcast/, (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  const db    = loadDB();
  const count = Object.keys(db.clients || {}).length;
  bot.sendMessage(msg.chat.id, "Razoslat posledniy obekt " + count + " klientam?\nNapishi /sendall");
});

bot.onText(/\/sendall/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  const db = loadDB();
  if (!db.properties.length) return bot.sendMessage(msg.chat.id, "Net obektov");
  const last    = db.properties[db.properties.length - 1];
  const clients = Object.keys(db.clients || {});
  let sent = 0;
  bot.sendMessage(msg.chat.id, "Rassylayu " + clients.length + " klientam...");
  for (const id of clients) {
    try { await showProperty(id, last, 0, 1); sent++; await new Promise(r => setTimeout(r, 500)); } catch {}
  }
  bot.sendMessage(msg.chat.id, "Gotovo! Otpravleno: " + sent + "/" + clients.length);
});

bot.onText(/\/makler/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  bot.sendMessage(msg.chat.id, "Proveryayu Makler...");
  await checkNewAds();
  bot.sendMessage(msg.chat.id, "Gotovo!");
});

bot.on("contact", async (msg) => {
  const chatId = msg.chat.id;
  const u      = users[chatId] || {};
  await confirmLead(chatId, msg, msg.contact.phone_number, u.property);
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data   = query.data;
  if (data === "noop") return bot.answerCallbackQuery(query.id);

  if (data.startsWith("prop_")) {
    const db    = loadDB();
    const index = parseInt(data.split("_")[1]);
    if (db.properties[index]) {
      await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      await showProperty(chatId, db.properties[index], index, db.properties.length);
    }
    return bot.answerCallbackQuery(query.id);
  }

  if (data.startsWith("want_")) {
    const db   = loadDB();
    const prop = db.properties.find(p => p.id === data.replace("want_", ""));
    users[chatId] = { type: "POKUPKA", property: prop ? prop.title : "" };
    bot.answerCallbackQuery(query.id);
    return bot.sendMessage(chatId,
      "Otlichno! Nazhmite knopku - menedzher svyazhetsya dlya prosmot ra " + (prop ? prop.title : "obekta"),
      contactKeyboard
    );
  }
});

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) {
    const u = users[chatId] || {};
    try {
      await bot.forwardMessage(ADMIN_ID, chatId, msg.message_id);
      await bot.sendMessage(ADMIN_ID, "Foto ot klienta: " + (msg.from.first_name || "-") + " @" + (msg.from.username || "net") + " Tip: " + (u.type || "-"));
    } catch {}
    return bot.sendMessage(chatId, "Foto polucheno! Menedzher svyazhetsya.", mainKeyboard);
  }
  const state = adminStates[chatId];
  if (!state || state.step !== "photo") return;
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  adminStates[chatId] = { ...state, photo: fileId, step: "title" };
  bot.sendMessage(chatId, "Foto prinyato! Shag 2/6: Vvedi nazvanie:");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text;
  if (!text || text.startsWith("/")) return;

  if (isAdmin(chatId) && adminStates[chatId]) {
    const state = adminStates[chatId];
    if (text === "/skip" && state.step === "photo") { adminStates[chatId] = { ...state, step: "title" }; return bot.sendMessage(chatId, "Shag 2/6: Nazvanie:"); }
    if (state.step === "title")   { adminStates[chatId] = { ...state, title:   text, step: "address" };  return bot.sendMessage(chatId, "Shag 3/6: Adres:"); }
    if (state.step === "address") { adminStates[chatId] = { ...state, address: text, step: "price" };    return bot.sendMessage(chatId, "Shag 4/6: Cena:"); }
    if (state.step === "price")   { adminStates[chatId] = { ...state, price:   text, step: "details" };  return bot.sendMessage(chatId, "Shag 5/6: Detali (komnaty, ploshchad, etazh) ili /skip:"); }
    if (state.step === "details") {
      let rooms = "", area = "", floor = "";
      if (text !== "/skip") {
        text.split(",").map(s => s.trim()).forEach(p => {
          if (p.includes("komnat") || p.includes("комнат")) rooms = p;
          else if (p.includes("м") || p.includes("m"))      area  = p;
          else if (p.includes("etazh") || p.includes("этаж")) floor = p;
        });
      }
      adminStates[chatId] = { ...state, rooms, area, floor, step: "description" };
      return bot.sendMessage(chatId, "Shag 6/6: Opisanie ili /skip:");
    }
    if (state.step === "description") {
      const db = loadDB();
      const newProp = {
        id: Date.now().toString(), photo: state.photo || null,
        title: state.title, address: state.address, price: state.price,
        rooms: state.rooms || "", area: state.area || "", floor: state.floor || "",
        description: text !== "/skip" ? text : "", date: new Date().toISOString()
      };
      db.properties.push(newProp);
      saveDB(db);
      delete adminStates[chatId];
      return bot.sendMessage(chatId,
        "Obekt dobavlen!\n\n" + newProp.title + "\n" + newProp.address + "\n" + newProp.price +
        "\n\nVsego: " + db.properties.length + "\n\nRazoslat? /broadcast"
      );
    }
  }

  if (text === "Назад") return bot.sendMessage(chatId, "Vyberite deystvie:", mainKeyboard);
  if (text === "Назад".normalize()) return bot.sendMessage(chatId, "Vyberite deystvie:", mainKeyboard);

  if (text.includes("Смотреть объекты") || text === "Смотреть объекты") {
    const db = loadDB();
    saveClient(chatId, "prosmotr");
    if (!db.properties.length) return bot.sendMessage(chatId, "Obnovlyaem katalog.\n777 26536 / 777 72473", mainKeyboard);
    await bot.sendMessage(chatId, "U nas " + db.properties.length + " obektov:", mainKeyboard);
    return showProperty(chatId, db.properties[0], 0, db.properties.length);
  }

  const actions = {
    "Купить недвижимость":    { type: "POKUPKA",   prompt: "Klient khochet kupit nedvizhimost. Sprosi rayon i byudzhet. Predlozhi katalog." },
    "Продать недвижимость":   { type: "PRODAZHA",  prompt: "Klient khochet prodat. Skazhi chto besplatno otsenim. Poprosi nomer." },
    "Сдать недвижимость":     { type: "SDACHA",    prompt: "Klient khochet sdat. Skazhi chto spetsializiruemsya na prodazhe." },
    "Снять недвижимость":     { type: "ARENDA",    prompt: "Klient khochet snyat. Skazhi chto zanimaemsya prodazhey." },
    "Рассчитать ипотеку":     { type: "IPOTEKA",   prompt: "Klient khochet rasschitat ipoteku. Sprosi stoimost, vznos i srok." },
    "Документы":              { type: "DOKUMENTY", prompt: "Klient sprashivaet pro dokumenty dlya sdelki v PMR. Rasskazhi kratko." },
    "Связаться с менеджером": { type: "SVYAZ",     prompt: "Klient khochet svyazatsya. Skazhi ostavit nomer - nazhat knopku." },
  };

  if (actions[text]) {
    const action = actions[text];
    users[chatId] = { type: action.type };
    saveClient(chatId, action.type);
    try {
      bot.sendChatAction(chatId, "typing");
      const reply = await askClaude(chatId, action.prompt);
      await bot.sendMessage(chatId, reply, mainKeyboard);
      return bot.sendMessage(chatId, "Nazhmite chtoby otpravit nomer:", contactKeyboard);
    } catch {
      return bot.sendMessage(chatId, "Oshibka. Poprobuy eshche raz.", mainKeyboard);
    }
  }

  const phone = extractPhone(text);
  if (phone && phone.length >= 7) {
    const u = users[chatId] || {};
    await confirmLead(chatId, msg, phone, u.property);
    return;
  }

  try {
    bot.sendChatAction(chatId, "typing");
    const t = setInterval(() => bot.sendChatAction(chatId, "typing"), 4000);
    const reply = await askClaude(chatId, text);
    clearInterval(t);
    return bot.sendMessage(chatId, reply, mainKeyboard);
  } catch (e) {
    return bot.sendMessage(chatId, "Oshibka. Poprobuy pozzhe.", mainKeyboard);
  }
});

(async () => {
  console.log("RealInvest BOT starting...");
  await checkNewAds();
  setInterval(checkNewAds, CHECK_INTERVAL);
  console.log("RealInvest BOT started!");
})();
