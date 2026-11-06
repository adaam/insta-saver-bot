const path = require('node:path');

const CONTENT_TYPES = {
    '.mp4': 'video/mp4',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
};

const fileOptions = (filePath) => ({
    filename: path.basename(filePath),
    contentType: CONTENT_TYPES[path.extname(filePath).toLowerCase()],
});

const sendSingleMedia = (bot, chatId, media, caption) => {
    const options = caption ? { caption } : {};
    if (media.mediaType === 'video') {
        return bot.sendVideo(chatId, media.filePath, options, fileOptions(media.filePath));
    }
    return bot.sendPhoto(chatId, media.filePath, options, fileOptions(media.filePath));
};

const sendInstagramMedia = async (bot, chatId, mediaFiles, caption) => {
    for (let offset = 0; offset < mediaFiles.length; offset += 10) {
        const group = mediaFiles.slice(offset, offset + 10);
        const groupCaption = offset === 0 ? caption : undefined;

        if (group.length === 1) {
            await sendSingleMedia(bot, chatId, group[0], groupCaption);
            continue;
        }

        await bot.sendMediaGroup(chatId, group.map((media, index) => ({
            type: media.mediaType,
            media: media.filePath,
            ...(index === 0 && groupCaption ? { caption: groupCaption } : {}),
            fileOptions: fileOptions(media.filePath),
        })));
    }
};

module.exports = {
    sendInstagramMedia,
};
