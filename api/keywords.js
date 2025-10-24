const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  try {
    // 環境変数の確認
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      return res.status(500).json({ 
        error: 'Missing environment variables',
        hasUrl: !!process.env.SUPABASE_URL,
        hasKey: !!process.env.SUPABASE_ANON_KEY
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // シンプルなGETのみ
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('keyword_responses')
        .select('*')
        .limit(5);

      if (error) {
        return res.status(500).json({ 
          error: 'Supabase error', 
          details: error.message,
          code: error.code
        });
      }

      return res.status(200).json({ 
        success: true, 
        count: data.length,
        data: data 
      });
    }

    return res.status(200).json({ message: 'Test endpoint working' });

  } catch (error) {
    return res.status(500).json({ 
      error: 'Server error', 
      message: error.message,
      stack: error.stack
    });
  }
};
