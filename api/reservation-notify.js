// api/reservation-notify.js
const axios = require('axios');

module.exports = async (req, res) => {
    // CORS設定
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            message: 'Method Not Allowed' 
        });
    }

    try {
        const { guestName, guestEmail, selectedTime } = req.body;

        console.log('📥 受信データ:', { guestName, guestEmail, selectedTime });

        if (!guestName || !guestEmail || !selectedTime) {
            return res.status(400).json({ 
                success: false, 
                message: '必須項目が不足しています' 
            });
        }

        // LINE通知を送信
        await sendLineNotification(guestName, guestEmail, selectedTime);

        res.status(200).json({ 
            success: true, 
            message: 'LINE通知送信成功!' 
        });
    } catch (error) {
        console.error('❌ エラー:', error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            message: 'サーバーエラー: ' + error.message 
        });
    }
};

async function sendLineNotification(name, email, time) {
    const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const LINE_USER_ID = process.env.LINE_USER_ID;

    if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_USER_ID) {
        throw new Error('LINE Bot設定が不足しています');
    }

    const message = {
        type: 'text',
        text: `🔔 新しい面接予約が入りました!\n\n👤 名前: ${name}\n📧 メール: ${email}\n🕒 希望時間: ${time}\n\n確認をお願いします。`
    };

    await axios.post(
        'https://api.line.me/v2/bot/message/push',
        {
            to: LINE_USER_ID,
            messages: [message]
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            }
        }
    );

    console.log('✅ LINE通知送信成功');
}
