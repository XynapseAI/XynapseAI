import axios from 'axios';
import { load } from 'cheerio';
import { createClient } from 'redis';
import axiosRetry from 'axios-retry';

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => console.error('Redis Client Error', err));
await redisClient.connect();

const ARTICLE_CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// Configure axios with retry for article fetching
const articleAxios = axios.create();
axiosRetry(articleAxios, {
  retries: 2,
  retryDelay: (retryCount) => Math.pow(2, retryCount) * 500, // Exponential backoff
  retryCondition: (error) => error.code === 'ECONNABORTED' || error.response?.status >= 500,
});

export async function fetchArticleContent(url) {
  const cacheKey = `article_content:${url}`;
  const cachedContent = await redisClient.get(cacheKey);
  if (cachedContent) {
    return cachedContent;
  }

  try {
    const response = await articleAxios.get(url, { timeout: 3000 }); // Reduced timeout for article fetching
    const $ = load(response.data);
    const paragraphs = $('p').map((i, el) => $(el).text()).get().join('\n');
    const content = paragraphs.slice(0, 500); // Limit to 500 characters
    await redisClient.setEx(cacheKey, ARTICLE_CACHE_DURATION / 1000, content);
    return content;
  } catch (error) {
    console.error(`Error fetching article ${url}: ${error.message}`);
    return '';
  }
}

export async function braveSearch({ query, count = 3, freshness = 'pm' }) {
  if (!process.env.BRAVE_API_KEY) {
    return { snippets: '', links: [] };
  }

  try {
    const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      params: {
        q: query,
        count,
        freshness,
        safesearch: 'strict',
      },
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': process.env.BRAVE_API_KEY,
      },
      timeout: 10000,
    });

    const results = response.data.web?.results || [];
    const links = results.slice(0, 2).map((result) => ({ // Limit to 2 articles
      text: result.title,
      url: result.url,
    })).filter(Boolean);

    const snippets = [];
    for (const result of results.slice(0, 2)) { // Process only 2 articles
      const content = await fetchArticleContent(result.url);
      snippets.push(`${result.title}: ${content || result.description || 'No content available.'}`);
    }

    return {
      snippets: snippets.length ? `### Latest Web Insights\n${snippets.join('\n\n')}\n` : '',
      links,
    };
  } catch (error) {
    console.error(`Brave Search Error: ${error.message}`);
    return { snippets: '', links: [] };
  }
}