// Telegram callback query handler — receives button taps from Telegram
// alerts and updates lead status without opening the CRM.
//
// Expected callback_data format: "action:leadId"
//   contacted:abc123  → set status to 'contacted'
//   quoted:abc123     → set status to 'quoted'
//   lost:abc123       → set status to 'lost'
//   booked:abc123     → set status to 'booked'

const { getStore } = require('@netlify/blobs'); // surface for scanner
const { setStatus, getLead } = require('./_lib/leads');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function tg(method, body){
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch(e){ console.error('TG '+method+' error:', e); return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'ok' };

  let update;
  try { update = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 200, body: 'ok' }; }

  const cb = update.callback_query;
  if (!cb) return { statusCode: 200, body: 'ok' };

  const data = cb.data || '';
  const [action, leadId] = data.split(':');
  if (!leadId) {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Invalid button.' });
    return { statusCode: 200, body: 'ok' };
  }

  const statusMap = {
    contacted: 'contacted',
    quoted:    'quoted',
    booked:    'booked',
    lost:      'lost',
    done:      'done',
  };
  const newStatus = statusMap[action];
  if (!newStatus) {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Unknown action.' });
    return { statusCode: 200, body: 'ok' };
  }

  let lead;
  try { lead = await setStatus(leadId, newStatus); }
  catch(e) { console.error('setStatus error:', e); }

  if (!lead) {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '❌ Lead not found.' });
    return { statusCode: 200, body: 'ok' };
  }

  // Acknowledge in Telegram chat
  const emoji = { contacted:'✅', quoted:'💬', booked:'🎉', lost:'❌', done:'🏁' }[newStatus];
  await tg('answerCallbackQuery', {
    callback_query_id: cb.id,
    text: `${emoji} ${lead.name} → ${newStatus.toUpperCase()}`,
    show_alert: false,
  });

  // Edit the original message to show the new state (strike through + append line)
  try {
    const originalText = cb.message?.text || '';
    const newText = originalText + `\n\n${emoji} Status updated → *${newStatus.toUpperCase()}* by ${cb.from?.first_name || 'admin'}`;
    await tg('editMessageText', {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: newText,
      parse_mode: 'Markdown',
      // Reduced buttons — just keep call + open crm
      reply_markup: {
        inline_keyboard: [
          lead.phone ? [{ text: '📞 Call', url: `tel:${lead.phone}` }] : [],
          [{ text: '📋 Open in CRM', url: `https://toromovers.net/crm#lead/${lead.id}` }],
        ].filter(r => r.length),
      },
    });
  } catch(e) { console.error('edit message failed:', e); }

  return { statusCode: 200, body: 'ok' };
};
