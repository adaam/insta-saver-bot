const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const TWITTER_HOSTS = new Set([
    'x.com',
    'www.x.com',
    'twitter.com',
    'www.twitter.com',
    'mobile.twitter.com',
]);

const cleanParsedUrl = (parsedUrl) => {
    parsedUrl.search = '';
    parsedUrl.hash = '';
    return parsedUrl;
};

const extractShortCode = (url) => {
    const regex = /\/(?:reel|reels|p|tv)\/([a-zA-Z0-9_-]+)/i;
    const match = url.match(regex);
    return match ? match[1] : null;
};

const extractTweet = (parsedUrl) => {
    const match = parsedUrl.pathname.match(
        /^\/((?:i\/web)|[^/]+)\/status\/(\d+)(?:\/(?:video|photo)\/\d+)?\/?$/i
    );
    if (!match) {
        return null;
    }

    parsedUrl.pathname = `/${match[1]}/status/${match[2]}`;
    return {
        tweetId: match[2],
        url: cleanParsedUrl(parsedUrl).toString(),
    };
};

const parseMediaUrl = (inputUrl) => {
    try {
        if (typeof inputUrl !== 'string') {
            throw new Error('Please send a valid Instagram or Twitter/X URL');
        }

        const parsedUrl = new URL(inputUrl.trim());
        const hostname = parsedUrl.hostname.toLowerCase();
        if (parsedUrl.protocol !== 'https:') {
            throw new Error('Please send a valid HTTPS Instagram or Twitter/X URL');
        }

        if (INSTAGRAM_HOSTS.has(hostname)) {
            const cleanedUrl = cleanParsedUrl(parsedUrl).toString();
            const shortCode = extractShortCode(cleanedUrl);
            if (!shortCode) {
                throw new Error('Please send a valid Instagram Reel or post URL');
            }
            return {
                success: true,
                platform: 'instagram',
                data: cleanedUrl,
                mediaId: shortCode,
            };
        }

        if (TWITTER_HOSTS.has(hostname)) {
            const tweet = extractTweet(parsedUrl);
            if (!tweet) {
                throw new Error('Please send a valid Twitter/X status URL');
            }
            return {
                success: true,
                platform: 'twitter',
                data: tweet.url,
                mediaId: tweet.tweetId,
            };
        }

        throw new Error('Please send a valid Instagram or Twitter/X URL');
    } catch (error) {
        return { success: false, data: error.message };
    }
};

const domainCleaner = (inputUrl) => {
    const result = parseMediaUrl(inputUrl);
    if (!result.success || result.platform !== 'instagram') {
        return { success: false, data: 'Please send a valid Instagram URL' };
    }
    return { success: true, data: result.data };
};

module.exports = {
    domainCleaner,
    extractShortCode,
    parseMediaUrl,
};
