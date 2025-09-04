// utils/braveSearch.js
import axios from 'axios';
import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';

export async function braveSearch({ query, count = 10, freshness = '1w' }) {
  if (!process.env.BRAVE_API_KEY) {
    console.warn('BRAVE_API_KEY is missing');
    return { snippets: '', links: [] };
  }

  // Define reputable crypto news sites
  const cryptoSites = [
    'site:wu-blockchain.xyz',
    'site:coindesk.com',
    'site:coinmarketcap.com',
    'site:coingecko.com',
    'site:theblock.co',
    'site:cryptoslate.com',
    'site:decrypt.co',
    'site:cointelegraph.com',
  ].join(' | ');

  // Refine query to target detailed news articles
  const refinedQuery = `${query} ${cryptoSites} -inurl:(login | signup)`;

  try {
    const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      params: {
        q: refinedQuery,
        count,
        freshness,
        safesearch: 'strict',
      },
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': process.env.BRAVE_API_KEY,
      },
      timeout: 15000, // Increased timeout for reliability
    });

    const results = response.data.web?.results || [];

    // Combine description and extra_snippets for snippets
    const snippets = results
      .map((result) => {
        const extra = result.extra_snippets ? result.extra_snippets.join(' ') : '';
        const combined = `${result.description || ''} ${extra}`.trim();
        return sanitizeHtml(combined, {
          allowedTags: [],
          allowedAttributes: {},
        });
      })
      .filter(Boolean)
      .join('\n\n');

    // Create links with enhanced metadata
    const links = await Promise.all(
      results
        .filter((result) => result.url && !result.url.includes('login') && !result.url.includes('signup'))
        .map(async (result) => {
          let thumbnail = result.thumbnail?.src || null;

          // Fallback: Fetch og:image if thumbnail is missing
          if (!thumbnail) {
            try {
              const pageResponse = await axios.get(result.url, { timeout: 5000 });
              const $ = cheerio.load(pageResponse.data);
              thumbnail = $('meta[property="og:image"]').attr('content') || null;
            } catch (e) {
              console.warn(`Failed to fetch og:image for ${result.url}: ${e.message}`);
            }
          }

          return {
            text: sanitizeHtml(result.title || result.url || 'Untitled', {
              allowedTags: [],
              allowedAttributes: {},
            }),
            url: result.url,
            description: sanitizeHtml(
              [result.description, ...(result.extra_snippets || [])].join(' ').trim().slice(0, 200) ||
                'No description available',
              { allowedTags: [], allowedAttributes: {} }
            ),
            image: thumbnail,
          };
        })
    );

    console.log(`Brave Search results for query "${refinedQuery}":`, {
      links,
      snippets,
      linkCount: links.length,
    });

    return {
      snippets: snippets ? `### Latest Crypto News\n${snippets}\n` : '',
      links: links.filter((link) => link.url),
    };
  } catch (error) {
    console.error(`Brave Search Error for query "${refinedQuery}": ${error.message}`);
    return { snippets: '', links: [] };
  }
}

export async function fetchFullContent(url) {
  try {
    const response = await axios.get(url, { timeout: 8000 });
    const html = response.data;
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $('script, style, noscript, iframe, nav, footer, header, [class*="ad"], [id*="ad"]').remove();

    // Target article content (common selectors for news sites)
    const articleContent = $('article, .post-content, .entry-content, .article-body, main')
      .text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

    const sanitizedContent = sanitizeHtml(articleContent, {
      allowedTags: [],
      allowedAttributes: {},
    });

    return sanitizedContent || 'No article content available';
  } catch (error) {
    console.error(`Error fetching content from ${url}: ${error.message}`);
    return '';
  }
}