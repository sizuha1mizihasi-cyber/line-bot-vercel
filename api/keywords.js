const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async function handler(req, res) {
  // GET: 全キーワード取得
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('keyword_responses')
        .select('*')
        .order('priority', { ascending: false });

      if (error) throw error;

      return res.status(200).json(data);
    } catch (error) {
      console.error('Error fetching keywords:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // POST: 新規キーワード追加
  if (req.method === 'POST') {
    try {
      const { keyword, response_text, url, priority } = req.body;

      if (!keyword || !response_text) {
        return res.status(400).json({ error: 'keyword and response_text are required' });
      }

      const { data, error } = await supabase
        .from('keyword_responses')
        .insert([{
          keyword,
          response_text,
          url: url || null,
          priority: priority || 0
        }])
        .select();

      if (error) throw error;

      return res.status(201).json(data[0]);
    } catch (error) {
      console.error('Error adding keyword:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
