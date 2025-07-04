// utils/braveSearch.js
import axios from 'axios';

export async function braveSearch({ query, count = 5, freshness = 'pm' }) {
  if (!process.env.BRAVE_API_KEY) {
    return { snippets: '', links: [] };
  }

  try {
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

    return {
      snippets: snippets ? `Lastest Web info:\n${snippets}\n\n` : '',
      links,
    };
  } catch (error) {
    return { snippets: '', links: [] };
  }
}