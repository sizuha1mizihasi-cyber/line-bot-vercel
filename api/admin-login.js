const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

module.exports = async function handler(req, res) {
  // CORS対応
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });
    }

    // 管理者ユーザーを検索
    const { data: adminUser, error: userError } = await supabase
      .from('admin_users')
      .select('*')
      .eq('username', username)
      .single();

    if (userError || !adminUser) {
      return res.status(401).json({ error: 'ユーザー名またはパスワードが間違っています' });
    }

    // パスワード検証
    const isValidPassword = await bcrypt.compare(password, adminUser.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'ユーザー名またはパスワードが間違っています' });
    }

    // JWTトークン生成
    const token = jwt.sign(
      { 
        adminId: adminUser.id, 
        username: adminUser.username 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // セッションをDBに保存
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const { error: sessionError } = await supabase
      .from('admin_sessions')
      .insert([{
        admin_id: adminUser.id,
        token: token,
        expires_at: expiresAt.toISOString()
      }]);

    if (sessionError) {
      console.error('Session save error:', sessionError);
    }

    return res.status(200).json({
      success: true,
      token: token,
      username: adminUser.username
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'ログイン処理中にエラーが発生しました' });
  }
};
