import { createInterface } from 'node:readline/promises';

export function verificationPhrase(documentId) {
  return `VERIFY ${String(documentId).slice(0, 8)}`;
}

export async function confirmDocumentVerification({ document, actor, input, output }) {
  if (!input?.isTTY || !output?.isTTY) {
    throw new Error('verify requires an attended interactive terminal; use the Library UI otherwise.');
  }
  if (typeof actor !== 'string' || !actor.trim()) {
    throw new Error('verify requires --as <human-name> for attribution.');
  }
  const phrase = verificationPhrase(document.id);
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`Type "${phrase}" to verify this exact document as ${actor.trim()}: `);
    if (answer.trim() !== phrase) {
      throw new Error('verification cancelled; the document was not changed.');
    }
  } finally {
    rl.close();
  }
}
