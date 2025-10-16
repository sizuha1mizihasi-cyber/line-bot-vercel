const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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
        const userId = event.source.userId;

        // 会話履歴を取得（最新10件）
        const conversationHistory = await getConversationHistory(userId, 10);

        // Gemini APIを呼び出し（履歴付き）
        const geminiResponse = await callGeminiWithHistory(userMessage, conversationHistory);

        // 会話をSupabaseに保存
        await saveConversation(userId, userMessage, geminiResponse);

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
 * 会話履歴を取得
 */
async function getConversationHistory(userId, limit = 10) {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('user_message, assistant_message, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching history:', error);
      return [];
    }

    // 古い順に並び替え（会話の流れに沿って）
    return data.reverse();
  } catch (error) {
    console.error('Supabase error:', error);
    return [];
  }
}

/**
 * 会話を保存
 */
async function saveConversation(userId, userMessage, assistantMessage) {
  try {
    const { error } = await supabase
      .from('conversations')
      .insert([
        {
          user_id: userId,
          user_message: userMessage,
          assistant_message: assistantMessage
        }
      ]);

    if (error) {
      console.error('Error saving conversation:', error);
    }
  } catch (error) {
    console.error('Supabase save error:', error);
  }
}

/**
 * Gemini APIを呼び出し（会話履歴付き）
 */
async function callGeminiWithHistory(message, conversationHistory) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;

  // 会話履歴をGemini用のフォーマットに変換
  const contents = [];

  // 過去の会話を追加
  conversationHistory.forEach(history => {
    contents.push({
      role: 'user',
      parts: [{ text: history.user_message }]
    });
    contents.push({
      role: 'model',
      parts: [{ text: history.assistant_message }]
    });
  });

  // 現在のメッセージを追加
  contents.push({
    role: 'user',
    parts: [{ text: message }]
  });

  const payload = {
    contents: contents,
    systemInstruction: {
      parts: [{
        text: 'あなたは親切で丁寧なアシスタントです。過去の会話内容を踏まえて、ユーザーの質問に答えてください。「さっきの」「先ほどの」などの表現があれば、会話履歴を参照して適切に対応してください。'
      }]
    },
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
