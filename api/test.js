import { testConnection } from '../lib/supabase.js';
import { callGemini } from '../lib/gemini.js';

export default async function handler(req, res) {
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
}
