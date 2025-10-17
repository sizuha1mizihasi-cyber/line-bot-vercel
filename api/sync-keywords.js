const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async function handler(req, res) {
  // 認証チェック（オプション）
  const authToken = req.headers['authorization'];
  const validToken = process.env.ADMIN_AUTH_TOKEN;

  if (validToken && authToken !== `Bearer ${validToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = 'keywords';
    
    // Google SheetsをCSVとして取得
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${sheetName}`;
    
    const response = await fetch(csvUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch sheet: ${response.status}`);
    }
    
    const csvText = await response.text();
    
    // CSVをパース
    const rows = parseCSV(csvText);
    
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No data in sheet' });
    }
    
    // ヘッダー行を取得
    const headers = rows[0];
    
    // データ行を処理
    const keywords = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      if (row.length < 2 || !row[0]) continue; // 空行をスキップ
      
      keywords.push({
        keyword: row[0],
        response_text: row[1] || '',
        url: row[2] || null,
        priority: parseInt(row[3]) || 0,
        is_active: row[4] === 'TRUE' || row[4] === 'true' || row[4] === '1'
      });
    }
    
    console.log(`Parsed ${keywords.length} keywords from sheet`);
    
    // Supabaseの既存データを全削除
    const { error: deleteError } = await supabase
      .from('keyword_responses')
      .delete()
      .neq('id', 0); // 全件削除
    
    if (deleteError) {
      console.error('Delete error:', deleteError);
    }
    
    // 新しいデータを挿入
    if (keywords.length > 0) {
      const { data, error: insertError } = await supabase
        .from('keyword_responses')
        .insert(keywords)
        .select();
      
      if (insertError) {
        throw insertError;
      }
      
      console.log(`Inserted ${data.length} keywords`);
    }
    
    return res.status(200).json({
      success: true,
      synced: keywords.length,
      message: `Successfully synced ${keywords.length} keywords`
    });
    
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};

/**
 * 簡易CSVパーサー
 */
function parseCSV(text) {
  const lines = text.split('\n');
  const result = [];
  
  for (let line of lines) {
    if (!line.trim()) continue;
    
    // ダブルクォートで囲まれた値を処理
    const row = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    row.push(current.trim());
    result.push(row);
  }
  
  return result;
}
