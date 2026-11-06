require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const app = express();
const { domainCleaner, extractShortCode } = require('./helper');
const { downloadInstagramMedia } = require('./instaloader');
const { sendInstagramMedia } = require('./telegramMedia');

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
        const welcomeMessage = `Hi ${firstName}, 👋\nWelcome to Insta Saver Bot!\n\nSend me a public Instagram Reel or post link. I will download its photos or videos locally and upload them here.`;

        await bot.sendMessage(chatId, welcomeMessage);
        return;
    }

    const urlResponse = domainCleaner(userMessage);
    if (!urlResponse.success) {
        await bot.sendMessage(chatId, urlResponse.data);
        return;
    }

    const shortCode = extractShortCode(urlResponse.data);
    if (!shortCode) {
        await bot.sendMessage(chatId, 'I could not find a Reel or post shortcode in that URL.');
        return;
    }

    let downloadingMessage;

    try {
        await bot.sendChatAction(chatId, 'upload_document');
        downloadingMessage = await bot.sendMessage(chatId, 'Downloading ⏳');

        console.log(`Downloading Instagram media: ${shortCode}`);
        const { mediaFiles, username, cached } = await downloadInstagramMedia(shortCode);

        console.log(
            `${cached ? 'Using cached' : 'Downloaded'} ${mediaFiles.length} media file(s) for @${username}: ${mediaFiles.map(({ filePath }) => filePath).join(', ')}`
        );
        await sendInstagramMedia(bot, chatId, mediaFiles, `Instagram: @${username} (${shortCode})`);
    } catch (error) {
        console.error(`Failed to process ${shortCode}:`, error.message);
        await bot.sendMessage(
            chatId,
            'Unable to download this post. It may be private, unavailable, or temporarily blocked by Instagram.'
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
