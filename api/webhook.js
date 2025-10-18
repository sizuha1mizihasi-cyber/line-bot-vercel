const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');

// Supabase初期化
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Google Drive初期化
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_DRIVE_PRIVATE_KEY.replace(/\\n/g, '\n')
  },
  scopes: ['https://www.googleapis.com/auth/drive']
});

const drive = google.drive({ version: 'v3', auth });

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

          // Google Driveにアップロード
          const driveFile = await uploadToDrive(userId, fileName, fileBuffer, event.message.type);

          // Geminiでファイル分析（画像の場合）
          let analysis = null;
          if (event.message.type === 'image') {
            analysis = await analyzeImageWithGemini(fileBuffer);
          }

          // メタデータをSupabaseに保存
          await saveFileMetadata(userId, fileName, event.message, driveFile, analysis);

          // ユーザーに通知
          await replyToLine(replyToken, 
            `ファイルを保存しました！\n` +
            `ファイル名: ${fileName}\n` +
            `保存先: Google Drive\n` +
            (analysis ? `\n分析結果:\n${analysis}` : '')
          );

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
 * 共有フォルダを検索
 */
async function findSharedFolder(folderName) {
  try {
    console.log(`Searching for shared folder: ${folderName}`);
    
    const response = await drive.files.list({
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name, owners)',
      spaces: 'drive',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    if (response.data.files && response.data.files.length > 0) {
      console.log(`Found shared folder: ${response.data.files[0].id}`);
      return response.data.files[0].id;
    }

    // 見つからない場合は環境変数のIDを使う
    console.log('Shared folder not found, using env var');
    return process.env.GOOGLE_DRIVE_FOLDER_ID;
  } catch (error) {
    console.error('Error finding shared folder:', error);
    return process.env.GOOGLE_DRIVE_FOLDER_ID;
  }
}

/**
 * Google Driveにアップロード
 */
async function uploadToDrive(userId, fileName, fileBuffer, fileType) {
  // 共有フォルダを検索
  const rootFolderId = await findSharedFolder('LINE Bot Files');

  // ユーザー専用フォルダを取得または作成
  const userFolderId = await getOrCreateUserFolder(userId, rootFolderId);

  // ファイルをアップロード
  const fileMetadata = {
    name: fileName,
    parents: [userFolderId]
  };

  const media = {
    mimeType: fileType === 'image' ? 'image/jpeg' : 'application/octet-stream',
    body: require('stream').Readable.from(fileBuffer)
  };

  console.log(`Uploading file to folder: ${userFolderId}`);

  const file = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, webViewLink',
    supportsAllDrives: true
  });

  console.log(`File uploaded successfully: ${file.data.id}`);

  return file.data;
}

/**
 * ユーザー専用フォルダを取得または作成
 */
async function getOrCreateUserFolder(userId, parentFolderId) {
  // 既存フォルダを検索
  console.log(`Searching for user folder: ${userId} in parent: ${parentFolderId}`);
  
  const response = await drive.files.list({
    q: `name='${userId}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });

  if (response.data.files && response.data.files.length > 0) {
    console.log(`User folder found: ${response.data.files[0].id}`);
    return response.data.files[0].id;
  }

  // フォルダが存在しない場合は作成
  console.log(`Creating user folder: ${userId}`);
  
  const fileMetadata = {
    name: userId,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId]
  };

  const folder = await drive.files.create({
    requestBody: fileMetadata,
    fields: 'id',
    supportsAllDrives: true
  });

  console.log(`User folder created: ${folder.data.id}`);

  return folder.data.id;
}

/**
 * Geminiで画像分析
 */
async function analyzeImageWithGemini(imageBuffer) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;

  const base64Image = imageBuffer.toString('base64');

  const payload = {
    contents: [{
      parts: [
        { text: "この画像の内容を簡潔に説明してください。" },
        {
          inline_data: {
            mime_type: "image/jpeg",
            data: base64Image
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 200
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('Gemini image analysis failed:', response.status);
      return null;
    }

    const data = await response.json();
    
    if (data.candidates && data.candidates[0]) {
      return data.candidates[0].content.parts[0].text;
    }

    return null;
  } catch (error) {
    console.error('Image analysis error:', error);
    return null;
  }
}

/**
 * ファイルメタデータをSupabaseに保存
 */
async function saveFileMetadata(userId, fileName, message, driveFile, analysis) {
  const { error } = await supabase
    .from('user_files')
    .insert([
      {
        user_id: userId,
        file_name: fileName,
        original_file_name: message.fileName || fileName,
        file_type: message.type,
        file_size: message.fileSize || 0,
        drive_file_id: driveFile.id,
        drive_web_link: driveFile.webViewLink,
        drive_folder_path: `/${userId}/${fileName}`,
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
