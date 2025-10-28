const bcrypt = require('bcryptjs');

// ここでパスワードを設定してください
const password = 'Ybj68hi0';  // ← 好きなパスワードに変更
const saltRounds = 10;

bcrypt.hash(password, saltRounds, (err, hash) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('パスワードハッシュが生成されました:');
    console.log(hash);
    console.log('\n========================================');
    console.log('Supabaseで以下のSQLを実行してください:');
    console.log('========================================');
    console.log(`INSERT INTO admin_users (username, password_hash) VALUES ('admin', '${hash}');`);
    console.log('========================================');
  }
});
