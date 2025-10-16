import { replyMessage } from '../lib/line.js';

export default async function handler(req, res) {
  // POSTメソッドのみ許可
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // LINE署名検証（簡易版）
  const signature = req.headers['x-line-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'No signature' });
  }

  try {
    const events = req.body.events;

    // イベントがない場合
    if (!events || events.length === 0) {
      return res.status(200).json({ message: 'No events' });
    }

    const event = events[0];

    // メッセージイベントのみ処理
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const replyToken = event.replyToken;

      // シンプルな返信（Geminiなし）
      const botMessage = `メッセージを受け取りました: "${userMessage}"`;

      await replyMessage(replyToken, botMessage);
    }

    return res.status(200).json({ message: 'OK' });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ message: 'Error handled' });
  }
}
