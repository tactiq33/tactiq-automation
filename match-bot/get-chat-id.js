/**
 * get-chat-id.js — يجيب الـchat_id تبعك تلقائيًّا.
 * الخطوات:
 *   1) اعمل بوت من @BotFather وحطّ التوكن بـ .env (TELEGRAM_BOT_TOKEN).
 *   2) افتح محادثة مع بوتك على تيليغرام وابعتله أي رسالة (مثلاً: hi).
 *   3) شغّل:  node match-bot/get-chat-id.js
 *   4) بينطبعلك الـchat_id — حطّه بـ .env (TELEGRAM_CHAT_ID).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

(async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.error('❌ حطّ TELEGRAM_BOT_TOKEN بـ .env أوّلاً.'); process.exit(1); }

  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const j = await res.json();
  if (!j.ok) { console.error('❌ خطأ من تيليغرام:', JSON.stringify(j)); process.exit(1); }

  const chats = {};
  (j.result || []).forEach((u) => {
    const m = u.message || u.channel_post || u.edited_message;
    if (m && m.chat) chats[m.chat.id] = (m.chat.title || m.chat.first_name || m.chat.username || '');
  });

  const ids = Object.keys(chats);
  if (ids.length === 0) {
    console.log('⚠️ ما في رسائل بعد. افتح بوتك على تيليغرام وابعتله رسالة (hi)، وبعدين شغّل هالسكربت من جديد.');
    return;
  }
  console.log('✅ الـchat_id اللي لقيتهم:\n');
  ids.forEach((id) => console.log(`   ${id}   (${chats[id]})`));
  console.log('\n👉 حطّ الرقم بـ .env:  TELEGRAM_CHAT_ID=' + ids[0]);
})().catch((e) => { console.error('❌ خطأ:', e.message || e); process.exit(1); });
