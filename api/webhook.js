module.exports = async function handler(req, res) {
  // GETリクエストの場合（検証用）
  if (req.method === 'GET') {
    return res.status(200).json({ message: 'Webhook endpoint is working!' });
  }

  // POSTリクエストの場合（LINE Botからのメッセージ）
  if (req.method === 'POST') {
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

        // LINE Messaging APIで返信
        const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        const url = 'https://api.line.me/v2/bot/message/reply';

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            replyToken: replyToken,
            messages: [{
              type: 'text',
              text: `メッセージを受け取りました: "${userMessage}"`
            }]
          })
        });

        if (!response.ok) {
          console.error('LINE API error:', response.status);
        }
      }

      return res.status(200).json({ message: 'OK' });

    } catch (error) {
      console.error('Webhook error:', error);
      return res.status(200).json({ message: 'Error handled' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
