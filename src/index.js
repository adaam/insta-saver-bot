require('dotenv').config();
process.env.NTBA_FIX_350 = process.env.NTBA_FIX_350 || '1';
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const app = express();
const { appendFailedDownload, startFailedDownloadRetryWorker } = require('./failureLog');
const { parseMediaUrl } = require('./helper');
const { downloadInstagramMedia, isInstagramRateLimitError } = require('./instaloader');
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

const downloadAndSendMedia = async (urlResponse, chatId, captionPrefix = '') => {
    const isInstagram = urlResponse.platform === 'instagram';
    const mediaId = urlResponse.mediaId;
    let uploadFiles = [];
    try {
        console.log(`Downloading ${urlResponse.platform} media: ${mediaId}`);
        let downloadResult;
        try {
            downloadResult = isInstagram
                ? await downloadInstagramMedia(mediaId)
                : await downloadTwitterMedia(urlResponse.data, mediaId);
        } catch (error) {
            error.isMediaDownloadFailure = true;
            throw error;
        }
        const { mediaFiles, username, cached } = downloadResult;
        console.log(
            `${cached ? 'Using cached' : 'Downloaded'} ${mediaFiles.length} media file(s) for @${username}: ${mediaFiles.map(({ filePath }) => filePath).join(', ')}`
        );
        uploadFiles = await prepareMediaForTelegram(mediaFiles);
        const sourceName = isInstagram ? 'Instagram' : 'X/Twitter';
        const caption = `${captionPrefix}${sourceName}: @${username} (${mediaId})`;
        await sendMediaFiles(bot, chatId, uploadFiles, caption);
    } finally {
        try {
            await cleanupPreparedMedia(uploadFiles);
        } catch (error) {
            console.warn('Unable to remove temporary Telegram media:', error.message);
        }
    }
};

startFailedDownloadRetryWorker({
    retryHandler: async (record, attempt) => {
        const urlResponse = parseMediaUrl(record.url);
        if (!urlResponse.success) {
            throw new Error(urlResponse.data);
        }
        const delay = attempt === 1 ? '1 hour' : '12 hours';
        console.log(`Retrying failed download after ${delay}: ${record.url}`);
        await downloadAndSendMedia(
            urlResponse,
            record.chatId,
            `Recovered after automatic ${delay} retry — `
        );
    },
    finalFailureHandler: async (record) => {
        await bot.sendMessage(
            record.chatId,
            `Automatic retries after 1 hour and 12 hours both failed for: ${record.url}`
        );
    },
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
    try {
        await bot.sendChatAction(chatId, 'upload_document');
        downloadingMessage = await bot.sendMessage(chatId, 'Downloading ⏳');

        try {
            await downloadAndSendMedia(urlResponse, chatId);
        } catch (error) {
            if (!error.isMediaDownloadFailure) {
                throw error;
            }
            try {
                await appendFailedDownload(urlResponse.data, { chatId });
            } catch (logError) {
                console.warn('Unable to record failed download:', logError.message);
            }
            throw error;
        }
    } catch (error) {
        console.error(`Failed to process ${urlResponse.platform} ${mediaId}:`, error.message);
        let errorMessage;
        if (urlResponse.platform === 'instagram' && isInstagramRateLimitError(error)) {
            errorMessage = 'Instagram rate limit reached (HTTP 429 Too Many Requests). Please wait before trying again.';
        } else if (urlResponse.platform === 'instagram') {
            errorMessage = 'Unable to download this post. It may be private, unavailable, or temporarily blocked by Instagram.';
        } else {
            errorMessage = 'Unable to download this Tweet media. It may be private or unavailable, require login, contain no supported media, or be temporarily blocked by Twitter/X.';
        }
        await bot.sendMessage(
            chatId,
            errorMessage
        );
    } finally {
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
