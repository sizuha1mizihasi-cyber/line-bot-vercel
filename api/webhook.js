const { createClient } = require('@supabase/supabase-js');

// Supabase初期化
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async function handler(req, res) {
  // GETリクエストの場合（検証用）
  if (req.method === 'GET') {
    return res.status(200).json({ message: 'Webhook endpoint is working!' });
  }

  // POSTリクエストの場合
  if (req.method === 'POST') {
    try {
      const events = req.body.events;

      if (!events || events.length === 0) {
        return res.status(200).json({ message: 'No events' });
      }

      const event = events[0];

      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;
        const replyToken = event.replyToken;
        const userId = event.source.userId;

        console.log('User ID:', userId);
        console.log('User Message:', userMessage);

        // モード切り替えコマンドをチェック
        if (userMessage === '/高速モード' || userMessage === '/fast') {
          await setUserMode(userId, 'fast');
          await replyToLine(replyToken, '⚡ 高速モードに切り替えました\n簡潔で素早い回答を提供します。');
          return res.status(200).json({ message: 'OK' });
        }

        if (userMessage === '/バランスモード' || userMessage === '/balanced') {
          await setUserMode(userId, 'balanced');
          await replyToLine(replyToken, '⚖️ バランスモードに切り替えました\n適度な長さで分かりやすく回答します。');
          return res.status(200).json({ message: 'OK' });
        }

        if (userMessage === '/詳細モード' || userMessage === '/detailed') {
          await setUserMode(userId, 'detailed');
          await replyToLine(replyToken, '📚 詳細モードに切り替えました\n詳しく丁寧に説明します。');
          return res.status(200).json({ message: 'OK' });
        }

        if (userMessage === '/設定' || userMessage === '/mode') {
          const currentMode = await getUserMode(userId);
          const modeNames = {
            fast: '⚡ 高速モード',
            balanced: '⚖️ バランスモード',
            detailed: '📚 詳細モード'
          };
          await replyToLine(replyToken, 
            `現在のモード: ${modeNames[currentMode]}\n\n` +
            `モード切り替え:\n` +
            `/高速モード - 簡潔で素早い回答\n` +
            `/バランスモード - 適度な長さの回答\n` +
            `/詳細モード - 詳しい説明`
          );
          return res.status(200).json({ message: 'OK' });
        }

        // 会話履歴を取得
        const userMode = await getUserMode(userId);
        const config = getModeConfig(userMode);
        let conversationHistory = [];
        try {
          conversationHistory = await getConversationHistory(userId, config.historyLimit);
          console.log('History count:', conversationHistory.length);
        } catch (historyError) {
          console.error('History fetch error:', historyError);
        }

        // ★ キーワード応答をチェック（文脈判定強化版）
        const keywordResponse = await checkKeywordResponse(userMessage, conversationHistory);
        if (keywordResponse) {
          console.log('Keyword match found:', keywordResponse);
          await replyToLine(replyToken, keywordResponse);
          // キーワード応答も履歴に保存
          await saveConversation(userId, userMessage, keywordResponse);
          return res.status(200).json({ message: 'OK' });
        }

        console.log('User mode:', userMode);

        // Gemini APIを呼び出し（モードに応じた設定）
        let geminiResponse;
        try {
          geminiResponse = await callGeminiWithHistory(
            userMessage, 
            conversationHistory, 
            config
          );
          console.log('Gemini response:', geminiResponse);
        } catch (geminiError) {
          console.error('Gemini error:', geminiError);
          geminiResponse = 'エラーが発生しました。もう一度お試しください。';
        }

        // 会話を保存
        try {
          await saveConversation(userId, userMessage, geminiResponse);
          console.log('Conversation saved');
        } catch (saveError) {
          console.error('Save error:', saveError);
        }

        // LINE に返信
        try {
          await replyToLine(replyToken, geminiResponse);
          console.log('Reply sent');
        } catch (replyError) {
          console.error('Reply error:', replyError);
        }
      }

      return res.status(200).json({ message: 'OK' });

    } catch (error) {
      console.error('Webhook error:', error);
      console.error('Error stack:', error.stack);
      return res.status(200).json({ message: 'Error handled' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

/**
 * キーワードに一致する応答を検索（文脈判定強化版）
 */
async function checkKeywordResponse(message, conversationHistory) {
  try {
    const { data, error } = await supabase
      .from('keyword_responses')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (error || !data || data.length === 0) {
      return null;
    }

    // キーワードが含まれるものをチェック
    for (const item of data) {
      if (message.includes(item.keyword)) {
        console.log(`Keyword "${item.keyword}" found in message`);
        
        // 文脈の関連性をチェック
        const isRelevant = await checkContextRelevance(message, item.keyword);
        
        console.log(`Context relevance for "${item.keyword}": ${isRelevant}`);
        
        if (isRelevant) {
          let responseText = item.response_text;
          if (item.url) {
            responseText += '\n' + item.url;
          }
          return responseText;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Keyword check error:', error);
    return null;
  }
}

/**
 * 文脈の関連性をチェック（強化版）
 */
async function checkContextRelevance(message, keyword) {
  // 明確に否定している表現（即座に反応しない）
  const strongNegativePatterns = [
    `${keyword}じゃなくて`,
    `${keyword}ではなく`,
    `${keyword}じゃない`,
    `${keyword}ではない`,
    `${keyword}以外`,
    `${keyword}を取りたくない`,
    `${keyword}したくない`,
    `${keyword}は不要`,
    `${keyword}はいらない`,
    `${keyword}は嫌`,
    `${keyword}やめ`,
    `${keyword}はやだ`,
    `${keyword}やだ`,
    `${keyword}はダメ`,
    `${keyword}ダメ`,
    `${keyword}は結構`,
    `${keyword}結構です`,
    `${keyword}は大丈夫`,
    `${keyword}大丈夫です`
  ];
  
  // 強い否定表現があれば即座に反応しない
  for (const pattern of strongNegativePatterns) {
    if (message.includes(pattern)) {
      console.log(`Strong negative pattern found: "${pattern}"`);
      return false;
    }
  }
  
  // 比較・質問の表現
  const comparisonPatterns = [
    '違い',
    'どっち',
    'どちら',
    'vs',
    'VS',
    '比較',
    'どう違う',
    '何が違う'
  ];
  
  // 比較表現がある場合はGeminiで判定
  const hasComparison = comparisonPatterns.some(pattern => message.includes(pattern));
  
  if (hasComparison) {
    console.log('Comparison pattern detected, checking with Gemini...');
    return await checkWithGemini(message, keyword);
  }
  
  // それ以外は反応する
  return true;
}

/**
 * Geminiで文脈判定（強化版）
 */
async function checkWithGemini(message, keyword) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;

  const prompt = `あなたは文脈判定AIです。以下のメッセージを分析してください。

【メッセージ】
"${message}"

【キーワード】
"${keyword}"

【質問】
このユーザーは「${keyword}」に関する具体的な情報（申し込み方法、URL、手続き、予約方法など）を求めていますか？

【判定基準】
以下の場合は「いいえ」：
- 他のものとの違いや比較を質問している
- 「〜とは何ですか」という定義を聞いている
- 否定的な文脈（〜じゃない、〜以外、など）
- 単に言及しているだけ

以下の場合は「はい」：
- 申し込みたい、予約したい
- URLが欲しい
- 手続き方法を知りたい
- 具体的なアクションを求めている

【回答】
「はい」または「いいえ」のみで答えてください。理由は不要です。`;

  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 10
    }
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error('Gemini context check failed:', response.status);
      return false; // エラー時は反応しない
    }

    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0]) {
      console.error('No candidates in Gemini response');
      return false;
    }
    
    const answer = data.candidates[0].content.parts[0].text.trim().toLowerCase();
    
    console.log(`Gemini context check result: "${answer}"`);
    
    const isRelevant = answer.includes('はい') || answer.includes('yes');
    return isRelevant;
    
  } catch (error) {
    console.error('Context check error:', error);
    return false; // エラー時は反応しない
  }
}

/**
 * ユーザーのモード設定を取得
 */
async function getUserMode(userId) {
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('mode')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return 'balanced';
    }

    return data.mode;
  } catch (error) {
    console.error('Error getting user mode:', error);
    return 'balanced';
  }
}

/**
 * ユーザーのモード設定を保存
 */
async function setUserMode(userId, mode) {
  try {
    const { error } = await supabase
      .from('user_settings')
      .upsert([
        {
          user_id: userId,
          mode: mode,
          updated_at: new Date().toISOString()
        }
      ]);

    if (error) {
      console.error('Error setting user mode:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in setUserMode:', error);
    return false;
  }
}

/**
 * モードに応じた設定を取得
 */
function getModeConfig(mode) {
  const configs = {
    fast: {
      historyLimit: 5,
      timeout: 15000,
      maxTokens: 512,
      instruction: 'あなたは親切で丁寧なアシスタントです。簡潔に答えてください。'
    },
    balanced: {
      historyLimit: 8,
      timeout: 20000,
      maxTokens: 768,
      instruction: 'あなたは親切で丁寧なアシスタントです。過去の会話内容を踏まえて、適度な長さで分かりやすく答えてください。'
    },
    detailed: {
      historyLimit: 10,
      timeout: 30000,
      maxTokens: 1024,
      instruction: 'あなたは親切で丁寧なアシスタントです。過去の会話内容を踏まえて、詳しく丁寧に説明してください。例を交えて分かりやすく答えてください。'
    }
  };

  return configs[mode] || configs.balanced;
}

/**
 * 会話履歴を取得
 */
async function getConversationHistory(userId, limit = 8) {
  const { data, error } = await supabase
    .from('conversations')
    .select('user_message, assistant_message, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Supabase select error:', error);
    throw error;
  }

  return (data || []).reverse();
}

/**
 * 会話を保存
 */
async function saveConversation(userId, userMessage, assistantMessage) {
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
    console.error('Supabase insert error:', error);
    throw error;
  }
}

/**
 * Gemini APIを呼び出し（会話履歴付き）
 */
async function callGeminiWithHistory(message, conversationHistory, config) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;

  const contents = [];

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

  contents.push({
    role: 'user',
    parts: [{ text: message }]
  });

  const payload = {
    contents: contents,
    systemInstruction: {
      parts: [{
        text: config.instruction
      }]
    },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: config.maxTokens,
      topP: 0.9,
      topK: 40
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      console.error('Gemini data error:', data.error);
      throw new Error(data.error.message);
    }

    if (!data.candidates || !data.candidates[0]) {
      console.error('No candidates in response:', data);
      throw new Error('No response from Gemini');
    }

    return data.candidates[0].content.parts[0].text;

  } catch (error) {
    console.error('callGeminiWithHistory error:', error);
    
    if (error.name === 'AbortError') {
      return '申し訳ありません。応答に時間がかかりすぎています。もう一度お試しください。';
    }
    
    throw error;
  }
}

/**
 * LINE に返信
 */
async function replyToLine(replyToken, message) {
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
        text: message
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('LINE API error:', response.status, errorText);
    throw new Error(`LINE API error: ${response.status}`);
  }

  return await response.json();
}
