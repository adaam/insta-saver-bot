const domainCleaner = (inputUrl) => {
    try {
        if (typeof inputUrl !== 'string') {
            throw new Error('Please send a valid Instagram URL');
        }

        const trimmedUrl = inputUrl.trim();
        const parsedUrl = new URL(trimmedUrl);

        if (
            parsedUrl.protocol !== 'https:' ||
            !['instagram.com', 'www.instagram.com'].includes(parsedUrl.hostname.toLowerCase())
        ) {
            throw new Error("Please send a valid Instagram URL");
        }

        parsedUrl.search = '';
        parsedUrl.hash = '';
        return { success: true, data: parsedUrl.toString() };
    } catch (error) {
        // Return success false and the error message
        return { success: false, data: error.message };
    }
}

const extractShortCode = (url) => {
    const regex = /\/(?:reel|reels|p|tv)\/([a-zA-Z0-9_-]+)/i;
    const match = url.match(regex);
    return match ? match[1] : null;
}

module.exports = {
    domainCleaner,
    extractShortCode,
};
