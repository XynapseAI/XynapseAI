// utils/braveSearch.js
import axios from 'axios';

export async function braveSearch({ query, count = 5, freshness = 'pm' }) {
  if (!process.env.BRAVE_API_KEY) {
    console.warn('BRAVE_API_KEY is missing');
    return { snippets: '', links: [] };
  }

  try {
    const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      params: {
        q: query,
        count,
        freshness,
        safesearch: 'strict', // Add safesearch for consistency with new version
      },
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': process.env.BRAVE_API_KEY,
      },
      timeout: 10000,
    });

    const results = response.data.web?.results || [];
    const snippets = results
      .map((result) => result.description)
      .filter(Boolean)
      .join('\n');
    const links = results.map((result) => result.url).filter(Boolean);

    console.log(`Brave Search results for query "${query}":`, { links, snippets });

    return {
      snippets: snippets ? `### Latest Web Insights\n${snippets}\n` : '',
      links,
    };
  } catch (error) {
    console.error(`Brave Search Error for query "${query}": ${error.message}`);
    return { snippets: '', links: [] };
  }
}