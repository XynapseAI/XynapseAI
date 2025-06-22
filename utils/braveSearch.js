// utils/braveSearch.js
import axios from 'axios';

export async function braveSearch({ query, count = 5, freshness = 'pm' }) {
  if (!process.env.BRAVE_API_KEY) {
    console.error('BRAVE_API_KEY không được cấu hình');
    return { snippets: '', links: [] };
  }

  try {
    console.log('Searching web with Brave Search API for:', query);
    const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      params: {
        q: query,
        count,
        freshness,
      },
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': process.env.BRAVE_API_KEY,
      },
    });

    const results = response.data.web?.results || [];
    const snippets = results
      .map((result) => result.description)
      .filter(Boolean)
      .join('\n');
    const links = results.map((result) => result.url).filter(Boolean);

    console.log('Brave Search results:', { snippets, links });
    return {
      snippets: snippets ? `Thông tin web mới nhất:\n${snippets}\n\n` : '',
      links,
    };
  } catch (error) {
    console.error('Brave Search API error:', error.response?.data || error.message);
    return { snippets: '', links: [] };
  }
}