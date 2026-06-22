#!/usr/bin/env node
// Print your Telegram chat id so you can set TELEGRAM_CHAT_ID.
//
// One-time setup:
//   1. Create a bot via @BotFather (/newbot) → copy the token.
//   2. Send any message to your new bot in Telegram.
//   3. TELEGRAM_BOT_TOKEN=<token> node scripts/telegram_chat_id.mjs
//
// Then put TELEGRAM_BOT_TOKEN + the printed chat id (TELEGRAM_CHAT_ID) into
// .env.local (dev) and Vercel env vars (prod). Never commit them.

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN first. See the header of this file.");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const data = await res.json();

if (!data.ok) {
  console.error("Telegram API error:", data.description ?? data);
  process.exit(1);
}

const chats = new Map();
for (const u of data.result ?? []) {
  const chat = u.message?.chat ?? u.edited_message?.chat ?? u.channel_post?.chat;
  if (chat) chats.set(chat.id, chat);
}

if (chats.size === 0) {
  console.error(
    "No messages found. Send a message to your bot in Telegram, then re-run.\n" +
      "(getUpdates only returns recent updates — message the bot first.)",
  );
  process.exit(1);
}

console.log("Found chat(s):");
for (const [id, chat] of chats) {
  const who = chat.username ? `@${chat.username}` : chat.title ?? `${chat.first_name ?? ""} ${chat.last_name ?? ""}`.trim();
  console.log(`  TELEGRAM_CHAT_ID=${id}   (${chat.type}${who ? `, ${who}` : ""})`);
}
