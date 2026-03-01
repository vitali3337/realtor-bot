# 🏠 Бот помощник для клиентов риелтора

Публичный Telegram-бот для покупателей и арендаторов недвижимости.

## Что умеет
- 🏠 Помогает подобрать квартиру (покупка или аренда)
- 🏦 Считает ипотечный платёж и переплату
- ❓ Отвечает на вопросы по документам и сделкам
- 📞 Записывает клиентов на просмотр

## Быстрый старт

```bash
npm install
cp .env.example .env
# Вставь токены в .env
node bot.js
```

## Деплой на Railway (бесплатно)
1. Загрузи на GitHub
2. railway.app → New Project → Deploy from GitHub
3. Добавь Variables: TELEGRAM_TOKEN, ANTHROPIC_API_KEY
4. Готово — бот работает 24/7

## Переменные окружения
- `TELEGRAM_TOKEN` — от @BotFather
- `ANTHROPIC_API_KEY` — с console.anthropic.com
