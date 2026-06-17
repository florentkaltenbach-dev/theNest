// hub/src/routes/council-mediator.js
//
// Council mediator: builds the prompt and calls the Anthropic Messages API.
// Exports: runMediator({ messages, participants, focus }). Depends: ANTHROPIC_API_KEY env var

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.COUNCIL_MEDIATOR_MODEL || 'claude-sonnet-4-6';
const MAX_THREAD = 100; // most recent messages handed to the mediator

const FOCUS_INSTRUCTIONS = {
  summarize: 'Summarize each participant\'s position fairly and concisely.',
  disagreements: 'Name the open disagreements neutrally. Do not resolve them or pick a side.',
  'next-step': 'Propose two or three concrete next steps the group could take.',
};

/**
 * Build the mediator system prompt.
 * @param {string[]} participants - distinct human display names in the thread
 * @param {string} [focus]
 * @returns {string}
 */
function buildSystemPrompt(participants, focus) {
  const roster = participants.length ? participants.join(', ') : 'the participants';
  const extra = FOCUS_INSTRUCTIONS[focus] ? `\n\nFor this turn specifically: ${FOCUS_INSTRUCTIONS[focus]}` : '';
  return [
    'You are Claude, acting as a neutral mediator in a shared discussion room.',
    `The human participants are: ${roster}.`,
    'Your role:',
    '- Attribute positions to the right person, by name.',
    '- Surface points of hidden agreement the group may not have noticed.',
    '- Name open disagreements neutrally, without resolving them.',
    '- Invite quieter participants into the conversation by name.',
    '- Propose concrete next steps when asked.',
    'You must never declare a winner, take a side, or tell the group what to decide.',
    'Keep your reply tight and readable. Plain text, no markdown headers.',
    extra,
  ].join('\n');
}

/**
 * Render the thread as `Author: text` lines, capped to the most recent messages.
 * @param {Array<{author: string, text: string}>} messages
 * @returns {string}
 */
function renderThread(messages) {
  return messages
    .slice(-MAX_THREAD)
    .map((m) => `${m.author}: ${m.text}`)
    .join('\n');
}

/**
 * Call the Anthropic Messages API to produce a mediator turn.
 * Throws an Error with a `.status` property on failure (503 when the key is unset).
 * @param {{ messages: Array, participants: string[], focus?: string }} input
 * @returns {Promise<{ text: string }>}
 */
export async function runMediator({ messages, participants, focus }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('Mediator unavailable: ANTHROPIC_API_KEY is not set.');
    err.status = 503;
    throw err;
  }

  const system = buildSystemPrompt(participants, focus);
  const thread = renderThread(messages);
  const userContent = thread
    ? `Here is the discussion so far:\n\n${thread}\n\nMediate as instructed.`
    : 'The discussion is empty so far. Invite the participants to state their opening positions.';

  let resp;
  try {
    resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
  } catch (e) {
    const err = new Error(`Mediator request failed: ${e.message}`);
    err.status = 502;
    throw err;
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const err = new Error(`Mediator API error ${resp.status}: ${body.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  const data = await resp.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  if (!text) {
    const err = new Error('Mediator returned an empty reply.');
    err.status = 502;
    throw err;
  }
  return { text };
}
