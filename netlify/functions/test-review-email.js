// TEST ENDPOINT — fires the review-request emails to a specified email
// address without touching any real leads or CRM status. Safe to call
// any time.
//
// Usage:
//   curl -X POST https://toromovers.net/.netlify/functions/test-review-email \
//     -H 'content-type: application/json' \
//     -d '{"email":"you@example.com","name":"Test User"}'
//
// Returns: IDs of the immediate + scheduled (+3d) review emails.
//
// Remove this file before going to production to prevent abuse.

const { sendReviewRequest } = require('./telegram-callback');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Use POST with {email, name}' }),
    };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const email = payload.email;
  const name  = payload.name || 'Test User';

  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'email required' }) };
  }

  // Build a dummy lead-like object
  const fakeLead = { id: 'test-' + Date.now(), name, email };

  try {
    const result = await sendReviewRequest(fakeLead);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        message: `Review emails queued for ${email}.`,
        result,
        note: 'Immediate fires now; follow-up arrives in 3 days. Check inbox.',
      }),
    };
  } catch (err) {
    console.error('test-review-email error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
