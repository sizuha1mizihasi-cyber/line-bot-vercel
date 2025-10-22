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

      // ★★★ USER ID取得コマンド ★★★
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;
        const userId = event.source.userId;
        const replyToken = event.replyToken;

        // 「テスト」と送られたらUSER IDを返す
        if (userMessage === 'テスト' || userMessage === 'test' || userMessage === 'TEST') {
          console.log('=============================');
          console.log('👤 USER ID:', userId);
          console.log('=============================');
          
          await replyToLine(replyToken, `あなたのUSER IDは:\n${userId}\n\nこのIDをコピーして、Vercelの環境変数 LINE_USER_ID に設定してください。`);
          return res.status(200).json({ message: 'OK' });
        }
      }

      // ★ ファイルメッセージの処理
      if (event.type === 'message' && (event.message.type === 'image' || event.message.type === 'file')) {
        const replyToken = event.replyToken;
        const userId = event.source.userId;
        const messageId = event.message.id;

        console.log('File message received:', event.message.type);

        try {
          // LINEからファイルをダウンロード
          const fileBuffer = await downloadLineFile(messageId);
          
          // ファイル名を生成
          const timestamp = new Date().toISOString().split('T')[0];
          const fileExtension = getFileExtension(event.message);
          const fileName = `${timestamp}_${messageId}.${fileExtension}`;

          // Supabase Storageにアップロード
          const storagePath = await uploadToSupabase(userId, fileName, fileBuffer, event.message.type);

          // Geminiでファイル分析（画像またはPDFの場合）
          let analysis = null;
          if (event.message.type === 'image') {
            analysis = await analyzeFileWithGemini(fileBuffer, 'image/jpeg', 'image');
          } else if (event.message.type === 'file' && fileExtension === 'pdf') {
            analysis = await analyzeFileWithGemini(fileBuffer, 'application/pdf', 'pdf');
          }

          // メタデータをSupabaseに保存
          await saveFileMetadata(userId, fileName, event.message, storagePath, analysis);

          // ユーザーに通知
          let notificationMessage = `ファイルを保存しました！\nファイル名: ${fileName}\n保存先: Supabase Storage`;
          
          if (analysis) {
            notificationMessage += `\n\n分析結果:\n${analysis}`;
          }

          await replyToLine(replyToken, notificationMessage);

          return res.status(200).json({ message: 'OK' });

        } catch (fileError) {
          console.error('File processing error:', fileError);
          await replyToLine(replyToken, 'ファイルの保存中にエラーが発生しました。');
          return res.status(200).json({ message: 'Error handled' });
        }
      }

      // ★ テキストメッセージの処理
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

        // キーワード応答をチェック
        const keywordResponse = await checkKeywordResponse(userMessage, conversationHistory);
        if (keywordResponse) {
          console.log('Keyword match found:', keywordResponse);
          await replyToLine(replyToken, keywordResponse);
          await saveConversation(userId, userMessage, keywordResponse);
          return res.status(200).json({ message: 'OK' });
        }

        console.log('User mode:', userMode);

        // Gemini APIを呼び出し
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

// 以下、既存の関数はそのまま...
// (downloadLineFile, getFileExtension, uploadToSupabase, analyzeFileWithGemini, 
//  saveFileMetadata, checkKeywordResponse, checkContextRelevance, checkWithGemini,
//  getUserMode, setUserMode, getModeConfig, getConversationHistory, 
//  saveConversation, callGeminiWithHistory, replyToLine)

/**
 * LINEからファイルをダウンロード
 */
async function downloadLineFile(messageId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * ファイル拡張子を取得
 */
function getFileExtension(message) {
  if (message.type === 'image') {
    return 'jpg';
  }
  if (message.type === 'file' && message.fileName) {
    const parts = message.fileName.split('.');
    return parts[parts.length - 1];
  }
  return 'bin';
}

/**
 * Supabase Storageにアップロード
 */
async function uploadToSupabase(userId, fileName, fileBuffer, fileType) {
  const storagePath = `${userId}/${fileName}`;

  console.log(`Uploading to Supabase Storage: ${storagePath}`);

  const { data, error } = await supabase.storage
    .from('user-files')
    .upload(storagePath, fileBuffer, {
      contentType: fileType === 'image' ? 'image/jpeg' : 'application/octet-stream',
      upsert: false
    });

  if (error) {
    console.error('Supabase upload error:', error);
    throw error;
  }

  console.log(`File uploaded successfully: ${storagePath}`);

  return storagePath;
}

/**
 * Geminiでファイル分析（画像・PDF対応）
 */
async function analyzeFileWithGemini(fileBuffer, mimeType, fileType) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;

  const base64File = fileBuffer.toString('base64');

  let prompt = '';
  let maxTokens = 500;
  
  if (fileType === 'image') {
    prompt = 'この画像の内容を日本語で簡潔に説明してください。';
    maxTokens = 200;
  } else if (fileType === 'pdf') {
    prompt = `このPDFファイルを分析して、以下の形式で日本語で回答してください：

【全体概要】
このPDFの主題と目的を簡潔に説明

【ページごとの内容】
1ページ目: （内容の要約）
2ページ目: （内容の要約）
3ページ目: （内容の要約）
...

【重要なポイント】
- ポイント1
- ポイント2
- ポイント3

【まとめ】
このPDFの結論や重要な情報`;
    maxTokens = 1500;
  }

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: mimeType,
            data: base64File
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: maxTokens
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini file analysis failed:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    
    if (data.candidates && data.candidates[0]) {
      return data.candidates[0].content.parts[0].text;
    }

    return null;
  } catch (error) {
    console.error('File analysis error:', error);
    return null;
  }
}

/**
 * ファイルメタデータをSupabaseに保存
 */
async function saveFileMetadata(userId, fileName, message, storagePath, analysis) {
  const { data: urlData } = supabase.storage
    .from('user-files')
    .getPublicUrl(storagePath);

  const { error } = await supabase
    .from('user_files')
    .insert([
      {
        user_id: userId,
        file_name: fileName,
        original_file_name: message.fileName || fileName,
        file_type: message.type,
        file_size: message.fileSize || 0,
        storage_location: 'supabase',
        storage_path: storagePath,
        storage_url: urlData.publicUrl,
        gemini_analysis: analysis
      }
    ]);

  if (error) {
    console.error('File metadata save error:', error);
    throw error;
  }
}

/**
 * キーワードに一致する応答を検索
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

    for (const item of data) {
      if (message.includes(item.keyword)) {
        console.log(`Keyword "${item.keyword}" found in message`);
        
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
 * 文脈の関連性をチェック
 */
async function checkContextRelevance(message, keyword) {
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
    `${keyword}大丈夫です`,
    `${keyword}取らなくていい`,
    `${keyword}を取らなくていい`
  ];
  
  for (const pattern of strongNegativePatterns) {
    if (message.includes(pattern)) {
      console.log(`Strong negative pattern found: "${pattern}"`);
      return false;
    }
  }
  
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
  
  const hasComparison = comparisonPatterns.some(pattern => message.includes(pattern));
  
  if (hasComparison) {
    console.log('Comparison pattern detected, checking with Gemini...');
    return await checkWithGemini(message, keyword);
  }
  
  return true;
}

/**
 * Geminiで文脈判定
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
      return false;
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
    return false;
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
