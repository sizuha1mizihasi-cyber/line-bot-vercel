// api/keywords.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async function handler(req, res) {
  // CORS設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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
      const { keyword, response_text, url, priority, is_active } = req.body;

      if (!keyword || !response_text) {
        return res.status(400).json({ error: 'keyword and response_text are required' });
      }

      const { data, error } = await supabase
        .from('keyword_responses')
        .insert([{
          keyword,
          response_text,
          url: url || null,
          priority: priority || 0,
          is_active: is_active !== undefined ? is_active : true
        }])
        .select();

      if (error) throw error;

      return res.status(201).json(data[0]);
    } catch (error) {
      console.error('Error adding keyword:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // PUT: キーワード更新
  if (req.method === 'PUT') {
    try {
      const { id, keyword, response_text, url, priority, is_active } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const updateData = {};
      if (keyword !== undefined) updateData.keyword = keyword;
      if (response_text !== undefined) updateData.response_text = response_text;
      if (url !== undefined) updateData.url = url;
      if (priority !== undefined) updateData.priority = priority;
      if (is_active !== undefined) updateData.is_active = is_active;

      const { data, error } = await supabase
        .from('keyword_responses')
        .update(updateData)
        .eq('id', id)
        .select();

      if (error) throw error;

      return res.status(200).json(data[0]);
    } catch (error) {
      console.error('Error updating keyword:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // DELETE: キーワード削除
  if (req.method === 'DELETE') {
    try {
      const { id } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const { error } = await supabase
        .from('keyword_responses')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return res.status(200).json({ success: true, message: 'Keyword deleted' });
    } catch (error) {
      console.error('Error deleting keyword:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
