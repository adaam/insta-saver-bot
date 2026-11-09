const path = require('node:path');

const CONTENT_TYPES = {
    '.mp4': 'video/mp4',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
};
const MAX_GROUP_BYTES = 47_000_000;

const fileOptions = (filePath) => ({
    filename: path.basename(filePath),
    contentType: CONTENT_TYPES[path.extname(filePath).toLowerCase()],
});

const sendSingleMedia = (bot, chatId, media, caption) => {
    const options = {
        ...(media.mediaType === 'video' ? media.videoMetadata : {}),
        ...(caption ? { caption } : {}),
    };
    if (media.mediaType === 'video') {
        return bot.sendVideo(chatId, media.filePath, options, fileOptions(media.filePath));
    }
    return bot.sendPhoto(chatId, media.filePath, options, fileOptions(media.filePath));
};

const sendMediaFiles = async (bot, chatId, mediaFiles, caption) => {
    const groups = [];
    let currentGroup = [];
    let currentSize = 0;
    for (const media of mediaFiles) {
        const fileSize = Number(media.fileSize) || 0;
        if (currentGroup.length > 0
            && (currentGroup.length === 10 || currentSize + fileSize > MAX_GROUP_BYTES)) {
            groups.push(currentGroup);
            currentGroup = [];
            currentSize = 0;
        }
        currentGroup.push(media);
        currentSize += fileSize;
    }
    if (currentGroup.length > 0) {
        groups.push(currentGroup);
    }

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const group = groups[groupIndex];
        const groupCaption = groupIndex === 0 ? caption : undefined;

        if (group.length === 1) {
            await sendSingleMedia(bot, chatId, group[0], groupCaption);
            continue;
        }

        await bot.sendMediaGroup(chatId, group.map((media, index) => ({
            type: media.mediaType,
            media: media.filePath,
            ...(media.mediaType === 'video' ? media.videoMetadata : {}),
            ...(index === 0 && groupCaption ? { caption: groupCaption } : {}),
            fileOptions: fileOptions(media.filePath),
        })));
    }
};

module.exports = {
    sendInstagramMedia: sendMediaFiles,
    sendMediaFiles,
};
