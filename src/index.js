require('dotenv').config();
process.env.NTBA_FIX_350 = process.env.NTBA_FIX_350 || '1';
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const app = express();
const { parseMediaUrl } = require('./helper');
const { downloadInstagramMedia } = require('./instaloader');
const { sendMediaFiles } = require('./telegramMedia');
const { cleanupPreparedMedia, prepareMediaForTelegram } = require('./telegramPrepare');
const { downloadTwitterMedia } = require('./twitter');

// Set the server to listen on port 6060
const PORT = process.env.PORT || 6060;

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
    throw new Error('TELEGRAM_TOKEN is required.');
}

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

bot.on('polling_error', (error) => {
    console.error('Telegram polling error:', error.message);
});

// Listen for any kind of message. There are different kinds of messages.
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userMessage = msg.text;

    if (typeof userMessage !== 'string') {
        return;
    }

    // Process user message
    if (userMessage === '/start') {
        const firstName = msg.from.first_name || '';
        const welcomeMessage = `Hi ${firstName}, 👋\nWelcome to Insta Saver Bot!\n\nSend me a public Instagram Reel/post link or a Twitter/X status link. I will download supported photos or videos locally and upload them here.`;

        await bot.sendMessage(chatId, welcomeMessage);
        return;
    }

    const urlResponse = parseMediaUrl(userMessage);
    if (!urlResponse.success) {
        await bot.sendMessage(chatId, urlResponse.data);
        return;
    }

    const mediaId = urlResponse.mediaId;

    let downloadingMessage;
    let uploadFiles = [];

    try {
        await bot.sendChatAction(chatId, 'upload_document');
        downloadingMessage = await bot.sendMessage(chatId, 'Downloading ⏳');

        const isInstagram = urlResponse.platform === 'instagram';
        console.log(`Downloading ${urlResponse.platform} media: ${mediaId}`);
        const { mediaFiles, username, cached } = isInstagram
            ? await downloadInstagramMedia(mediaId)
            : await downloadTwitterMedia(urlResponse.data, mediaId);

        console.log(
            `${cached ? 'Using cached' : 'Downloaded'} ${mediaFiles.length} media file(s) for @${username}: ${mediaFiles.map(({ filePath }) => filePath).join(', ')}`
        );
        uploadFiles = await prepareMediaForTelegram(mediaFiles);
        const sourceName = isInstagram ? 'Instagram' : 'X/Twitter';
        await sendMediaFiles(bot, chatId, uploadFiles, `${sourceName}: @${username} (${mediaId})`);
    } catch (error) {
        console.error(`Failed to process ${urlResponse.platform} ${mediaId}:`, error.message);
        const errorMessage = urlResponse.platform === 'instagram'
            ? 'Unable to download this post. It may be private, unavailable, or temporarily blocked by Instagram.'
            : 'Unable to download this Tweet media. It may be private or unavailable, require login, contain no supported media, or be temporarily blocked by Twitter/X.';
        await bot.sendMessage(
            chatId,
            errorMessage
        );
    } finally {
        try {
            await cleanupPreparedMedia(uploadFiles);
        } catch (error) {
            console.warn('Unable to remove temporary Telegram media:', error.message);
        }
        if (downloadingMessage) {
            try {
                await bot.deleteMessage(chatId, downloadingMessage.message_id);
            } catch (error) {
                console.warn('Unable to delete status message:', error.message);
            }
        }
    }
});

// Define a route for the GET request on the root endpoint '/'
app.get('/', (req, res) => {
    // Send the response 'Hello' when the endpoint is accessed
    res.send('Hello from InstaSaver Bot!');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
