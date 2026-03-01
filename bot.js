const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');

// ── Конфигурация ──────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'ВАШ_TELEGRAM_TOKEN';
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY || 'ВАШ_ANTHROPIC_KEY';

const bot    = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ── Системный промпт ──────────────────────────────────────────
const SYSTEM_PROMPT = `Ты — вежливый и профессиональный помощник агентства недвижимости. 
Ты общаешься с потенциальными покупателями и арендаторами квартир.

Твои задачи:
1. 🏠 ПОДБОР ЖИЛЬЯ — помогаешь клиенту сформулировать требования к квартире (район, площадь, бюджет, этаж, ремонт и т.д.)
2. 🏦 ИПОТЕКА — рассчитываешь ипотечный платёж по параметрам клиента, объясняешь условия
3. ❓ ВОПРОСЫ — отвечаешь на любые вопросы о покупке, аренде, документах, сделках
4. 📋 ДОКУМЕНТЫ — объясняешь какие документы нужны для покупки/аренды
5. 📞 ЗАПИСЬ — предлагаешь записаться на консультацию или просмотр объекта

Правила:
- Всегда будь вежлив, терпелив и дружелюбен
- Отвечай на русском языке простым и понятным языком
- Если клиент готов к просмотру или консультации — предложи оставить номер телефона
- Используй эмодзи для удобства чтения
- Не выдумывай конкретные объекты и адреса — только помогай с вопросами
- Если вопрос юридический — рекомендуй проконсультироваться с юристом агентства`;

// ── Хранилище ─────────────────────────────────────────────────
const conversations = new Map();

function getHistory(chatId) {
  if (!conversations.has(chatId)) conversations.set(chatId, []);
  return conversations.get(chatId);
}

function addToHistory(chatId, role, content) {
  const history = getHistory(chatId);
  history.push({ role, content });
  if (history.length > 40) history.splice(0, history.length - 40);
}

// ── Меню ──────────────────────────────────────────────────────
const MAIN_MENU = {
  reply_markup: {
    keyboard: [
      ['🏠 Хочу купить квартиру',  '🔑 Хочу снять квартиру'],
      ['🏦 Рассчитать ипотеку',    '❓ Вопрос по документам'],
      ['📞 Записаться на просмотр','💬 Другой вопрос'],
    ],
    resize_keyboard: true,
    persistent: true
  }
};

const QUICK_PROMPTS = {
  '🏠 Хочу купить квартиру': 'Клиент хочет купить квартиру. Поздоровайся и задай уточняющие вопросы: какой район, бюджет, площадь, количество комнат, важные требования. Веди диалог шаг за шагом.',
  '🔑 Хочу снять квартиру':  'Клиент хочет снять квартиру. Поздоровайся и уточни: район, бюджет в месяц, количество комнат, на какой срок, есть ли животные или дети. Веди диалог дружелюбно.',
  '🏦 Рассчитать ипотеку':   'Клиент хочет рассчитать ипотеку. Спроси: стоимость квартиры, размер первоначального взноса, желаемый срок кредита. Затем рассчитай ежемесячный платёж и переплату при средней ставке ~16% годовых. Покажи расчёт наглядно.',
  '❓ Вопрос по документам': 'Клиент хочет узнать про документы. Спроси: он покупает или снимает, первичный или вторичный рынок, есть ли ипотека. Затем расскажи какие документы нужны.',
  '📞 Записаться на просмотр':'Клиент хочет записаться на просмотр квартиры. Уточни какой объект его интересует (адрес или описание), удобное время. Скажи что менеджер свяжется с ним — попроси оставить номер телефона.',
  '💬 Другой вопрос':         'Клиент хочет задать вопрос. Спроси чем можешь помочь.',
};

// ── Claude API ────────────────────────────────────────────────
async function askClaude(chatId, userMessage) {
  addToHistory(chatId, 'user', userMessage);
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: getHistory(chatId),
  });
  const reply = response.content[0]?.text || 'Нет ответа.';
  addToHistory(chatId, 'assistant', reply);
  return reply;
}

async function sendReply(chatId, text, extra = {}) {
  const chunks = [];
  let t = text;
  while (t.length > 0) { chunks.push(t.slice(0, 4000)); t = t.slice(4000); }
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    try {
      await bot.sendMessage(chatId, chunks[i], isLast ? { parse_mode: 'Markdown', ...extra } : { parse_mode: 'Markdown' });
    } catch {
      await bot.sendMessage(chatId, chunks[i], isLast ? extra : {});
    }
  }
}

// ── Команды ───────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || '';
  bot.sendMessage(msg.chat.id,
    `👋 Здравствуйте${name ? ', ' + name : ''}!\n\n` +
    `Я — помощник агентства недвижимости 🏠\n\n` +
    `Помогу вам:\n` +
    `🏠 Подобрать квартиру для покупки или аренды\n` +
    `🏦 Рассчитать ипотечный платёж\n` +
    `❓ Ответить на вопросы по документам и сделкам\n` +
    `📞 Записать на просмотр объекта\n\n` +
    `Выберите с чего начнём 👇`,
    { parse_mode: 'Markdown', ...MAIN_MENU }
  );
});

bot.onText(/\/menu/, (msg) => {
  bot.sendMessage(msg.chat.id, '👇 Чем могу помочь?', MAIN_MENU);
});

bot.onText(/\/clear/, (msg) => {
  conversations.delete(msg.chat.id);
  bot.sendMessage(msg.chat.id, '🔄 Начнём сначала! Чем могу помочь?', MAIN_MENU);
});

// ── Основной обработчик ───────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text   = msg.text;
  if (!text || text.startsWith('/')) return;

  const prompt = QUICK_PROMPTS[text] || text;

  try {
    bot.sendChatAction(chatId, 'typing');
    const typingInterval = setInterval(() => bot.sendChatAction(chatId, 'typing'), 4000);
    const reply = await askClaude(chatId, prompt);
    clearInterval(typingInterval);
    await sendReply(chatId, reply, MAIN_MENU);
  } catch (err) {
    console.error('Ошибка:', err.message);
    bot.sendMessage(chatId,
      `😔 Произошла техническая ошибка. Попробуйте ещё раз или свяжитесь с нами напрямую.`,
      MAIN_MENU
    );
  }
});

console.log('🏠 Бот для клиентов риелтора запущен!');
