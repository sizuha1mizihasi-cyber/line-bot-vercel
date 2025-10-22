// api/get-user-id.js
module.exports = async (req, res) => {
    // POSTリクエスト以外は無視
    if (req.method !== 'POST') {
        return res.status(200).send('OK');
    }

    try {
        const events = req.body.events;

        if (events && events.length > 0) {
            events.forEach(event => {
                console.log('=============================');
                console.log('📩 イベントタイプ:', event.type);
                console.log('👤 USER ID:', event.source.userId);
                console.log('👥 ソースタイプ:', event.source.type);
                console.log('=============================');
            });
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('エラー:', error);
        res.status(200).send('OK');
    }
};
