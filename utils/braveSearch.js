// utils/braveSearch.js
import axios from 'axios';
import * as cheerio from 'cheerio'; // Sửa: dùng * as cheerio thay vì default import

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
        safesearch: 'strict',
      },
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': process.env.BRAVE_API_KEY,
      },
      timeout: 10000,
    });

    const results = response.data.web?.results || [];
    
    // Kết hợp description và extra_snippets để có nội dung chi tiết hơn
    const snippets = results
      .map((result) => {
        const extra = result.extra_snippets ? result.extra_snippets.join('\n') : '';
        return `${result.description}\n${extra}`.trim();
      })
      .filter(Boolean)
      .join('\n\n');

    // Trả về links dưới dạng objects để hỗ trợ Link Preview
    const links = results.map((result) => ({
      text: result.title || result.url,
      url: result.url,
      description: [result.description, ...(result.extra_snippets || [])].join(' ').trim().slice(0, 200),
      image: result.thumbnail?.src || null,
    })).filter(link => link.url);

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

// Hàm lấy full content từ URL (dùng cheerio)
async function fetchFullContent(url) {
  try {
    const res = await axios.get(url, { timeout: 5000 });
    const html = res.data;
    const $ = cheerio.load(html); // Sử dụng cheerio.load
    $('script, style, noscript, iframe').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);
    return text;
  } catch (e) {
    console.error(`Error fetching content from ${url}: ${e.message}`);
    return '';
  }
}

export { fetchFullContent };