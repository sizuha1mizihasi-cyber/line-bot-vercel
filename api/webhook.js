module.exports = async function handler(req, res) {
  // GETリクエストの場合
  if (req.method === 'GET') {
    return res.status(200).json({ message: 'Webhook endpoint is working!' });
  }

  // POSTリクエストの場合
  if (req.method === 'POST') {
    return res.status(200).json({ message: 'POST received' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
