const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('count')
      .limit(1);
    
    if (error) throw error;
    return { success: true, message: 'Supabase connected!' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

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
      return 'タイムアウトしました';
    }
    
    return 'エラーが発生しました: ' + error.message;
  }
}

module.exports = async function handler(req, res) {
  const results = {
    timestamp: new Date().toISOString(),
    supabase: null,
    gemini: null
  };

  // Supabaseテスト
  try {
    results.supabase = await testConnection();
  } catch (error) {
    results.supabase = { success: false, message: error.message };
  }

  // Geminiテスト
  try {
    const message = req.query.message || 'こんにちは';
    const response = await callGemini(message);
    results.gemini = { 
      success: true, 
      input: message,
      output: response 
    };
  } catch (error) {
    results.gemini = { success: false, message: error.message };
  }

  return res.status(200).json(results);
};
