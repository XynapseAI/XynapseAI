/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: 'https://xynapseai.net',
  generateRobotsTxt: true,
  sitemapSize: 7000,
  changefreq: 'daily',
  additionalPaths: async (config) => [
    { loc: 'https://xynapseai.net', changefreq: 'daily', priority: 1.0 },
    { loc: 'https://xynapseai.net/dashboard?tab=etf', changefreq: 'daily', priority: 0.8 },
    { loc: 'https://xynapseai.net/dashboard?tab=explorer', changefreq: 'daily', priority: 0.9 },
    { loc: 'https://xynapseai.net/dashboard?tab=treemap', changefreq: 'weekly', priority: 0.7 },
    { loc: 'https://xynapseai.net/dashboard?tab=market', changefreq: 'daily', priority: 0.8 },
    { loc: 'https://xynapseai.net/dashboard?tab=cluster', changefreq: 'daily', priority: 0.7 },
    { loc: 'https://xynapseai.net/dashboard?tab=graph', changefreq: 'weekly', priority: 0.7 },
  ],
};