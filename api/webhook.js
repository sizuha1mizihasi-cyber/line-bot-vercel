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

        // Gemini APIを呼び出し
        const geminiResponse = await callGemini(userMessage);

        // LINE Messaging APIで返信
        await replyToLine(replyToken, geminiResponse);
      }

      return res.status(200).json({ message: 'OK' });

    } catch (error) {
      console.error('Webhook error:', error);
      return res.status(200).json({ message: 'Error handled' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

/**
 * Gemini APIを呼び出し
 */
async function callGemini(message) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{
      parts: [{ text: message }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024
    }
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.candidates[0].content.parts[0].text;

  } catch (error) {
    console.error('Gemini error:', error);
    
    if (error.name === 'AbortError') {
      return '申し訳ありません。応答に時間がかかりすぎています。もう一度お試しください。';
    }
    
    return 'エラーが発生しました。もう一度お試しください。';
  }
}

/**
 * LINE Messaging APIで返信
 */
async function replyToLine(replyToken, message) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const url = 'https://api.line.me/v2/bot/message/reply';

  try {
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
          text: message
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LINE API error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error replying to LINE:', error);
    throw error;
  }
}
