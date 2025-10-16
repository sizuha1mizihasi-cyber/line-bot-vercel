/**
 * LINE Messaging APIでメッセージを返信
 */
export async function replyMessage(replyToken, message) {
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
