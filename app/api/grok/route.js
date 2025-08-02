// app/api/grok/route.js
import { braveSearch } from '../../../utils/braveSearch.js';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha.js';
import { auth } from '../auth/[...nextauth]/route.js';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import winston from 'winston';
import { NextResponse } from 'next/server';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  handler: () => {
    return NextResponse.json(
      { detail: 'Vượt quá giới hạn yêu cầu, vui lòng thử lại sau.' },
      { status: 429 }
    );
  },
  keyGenerator: (req) => req.ip || req.headers.get('x-forwarded-for') || 'unknown-ip',
});

const validate = [
  body('prompt')
    .isString()
    .isLength({ min: 1, max: 1500 })
    .withMessage('Prompt phải là chuỗi từ 1 đến 1500 ký tự'),
  body('deepSearch')
    .optional()
    .isBoolean()
    .withMessage('deepSearch phải là boolean'),
  body('tokenSymbol')
    .optional()
    .isString()
    .isLength({ max: 20 })
    .withMessage('tokenSymbol không được vượt quá 20 ký tự'),
  body('recaptchaToken')
    .isString()
    .notEmpty()
    .withMessage('Token reCAPTCHA là bắt buộc'),
];

export async function POST(req) {
  const ip = req.ip || req.headers.get('x-forwarded-for') || 'unknown';
  logger.info(`Yêu cầu đến /api/grok từ IP ${ip}`);

  try {
    await new Promise((resolve, reject) => {
      limiter(req, null, (err) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    logger.error(`Lỗi giới hạn yêu cầu: ${err.message}`);
    return NextResponse.json(
      { detail: 'Vượt quá giới hạn yêu cầu, vui lòng thử lại sau.' },
      { status: 429 }
    );
  }

  const session = await auth(req);
  if (!session) {
    logger.warn('Cố gắng truy cập trái phép vào API Grok');
    return NextResponse.json(
      { detail: 'Chưa đăng nhập: Vui lòng đăng nhập.' },
      { status: 401 }
    );
  }

  const body = await req.json();
  await Promise.all(validate.map((validation) => validation.run({ body })));
  const errors = validationResult({ body });
  if (!errors.isEmpty()) {
    logger.warn(`Lỗi xác thực: ${JSON.stringify(errors.array())}`);
    return NextResponse.json({ errors: errors.array() }, { status: 400 });
  }

  const { prompt, deepSearch = false, tokenSymbol, recaptchaToken } = body;
  logger.info(
    `Xử lý yêu cầu Grok: prompt="${prompt.substring(0, 50)}...", deepSearch=${deepSearch}, tokenSymbol="${
      tokenSymbol || 'none'
    }"`
  );

  try {
    let action = 'chat';
    if (prompt.match(/\bPredict\b/i)) {
      action = 'predict';
    } else if (prompt.match(/\b(Analyze|Analysis)\b/i) || tokenSymbol) {
      action = 'analyze';
    }
    logger.info(`Xác minh reCAPTCHA với hành động: ${action}`);
    await verifyRecaptcha(recaptchaToken, action, ip);
  } catch (error) {
    logger.error(`Xác minh reCAPTCHA thất bại: ${error.message}`);
    return NextResponse.json({ detail: error.message }, { status: 403 });
  }

  if (!process.env.XAI_API_KEY) {
    logger.error('XAI_API_KEY chưa được cấu hình');
    return NextResponse.json(
      { detail: 'Lỗi cấu hình server' },
      { status: 500 }
    );
  }

  try {
    const isTokenRelated =
      tokenSymbol ||
      prompt.match(/\b(btc|bitcoin|eth|sol|ada|xrp|doge|crypto|token|coin|blockchain)\b/i);
    const effectiveTokenSymbol =
      tokenSymbol?.toUpperCase() ||
      prompt.match(/\b(btc|bitcoin|eth|sol|ada|xrp|doge)\b/i)?.[0]?.toUpperCase() ||
      'BTC';

    let tokenAnalysis = '';
    let links = [];
    if (isTokenRelated && (prompt.match(/\b(Analyze|Analysis|Predict)\b/i) || tokenSymbol)) {
      try {
        const analysisResponse = await axios.post(
          `${process.env.NEXTAUTH_URL}/api/token-analysis`,
          {
            tokenSymbol: effectiveTokenSymbol,
            recaptchaToken,
          }
        );
        tokenAnalysis = analysisResponse.data.aiAnalysis || 'Không có phân tích mạng xã hội.';
        links = analysisResponse.data.links || [];

        if (prompt.match(/\b(Analyze|Analysis|Predict)\b/i)) {
          const economicSearch = await braveSearch({
            query: `${effectiveTokenSymbol} crypto price CPI Non-Farm Payrolls GDP Federal Reserve`,
            count: 3,
            freshness: '1m',
          });
          const stockMarketSearch = await braveSearch({
            query: `${effectiveTokenSymbol} crypto price S&P 500 Nasdaq correlation`,
            count: 3,
            freshness: '1m',
          });
          const politicalSearch = await braveSearch({
            query: `${effectiveTokenSymbol} crypto price political news`,
            count: 3,
            freshness: '1m',
          });

          tokenAnalysis += `
### Tác động kinh tế Mỹ
${economicSearch.snippets || 'Không có dữ liệu kinh tế gần đây.'}

### Tương quan thị trường chứng khoán
${stockMarketSearch.snippets || 'Không có dữ liệu tương quan thị trường chứng khoán gần đây.'}

### Tác động tin tức chính trị
${politicalSearch.snippets || 'Không có tin tức chính trị ảnh hưởng đến thị trường gần đây.'}
          `;
          links = [
            ...links,
            ...(economicSearch.links || []),
            ...(stockMarketSearch.links || []),
            ...(politicalSearch.links || []),
          ];
        }
      } catch (analysisError) {
        logger.error(`Lỗi phân tích token: ${analysisError.message}`);
        tokenAnalysis = 'Không thể lấy phân tích mạng xã hội hoặc dữ liệu bổ sung.';
      }
    }

    let recentInteractions = '';
    if (session?.user?.id) {
      try {
        const interactions = await axios.get(`${process.env.NEXTAUTH_URL}/api/ai-interaction`, {
          params: { uid: session.user.id, limit: 5 },
        });
        recentInteractions = interactions.data.interactions
          .map((i) => `Câu hỏi: ${i.query}\nTrả lời: ${i.response}`)
          .join('\n---\n');
      } catch (interactionError) {
        logger.error(`Lỗi lấy tương tác AI: ${interactionError.message}`);
        recentInteractions = 'Không thể lấy tương tác gần đây.';
      }
    }

    let searchContext = '';
    if (deepSearch) {
      try {
        const { snippets, links: searchLinks } = await braveSearch({
          query: prompt,
          count: 5,
          freshness: 'pm',
        });
        searchContext += snippets ? `### Thông tin web\n${snippets}\n` : '';
        links = links.concat(searchLinks || []);
      } catch (braveError) {
        logger.error(`Lỗi tìm kiếm Brave: ${braveError.message}`);
        searchContext += '\n### Thông tin web\nKhông thể lấy thông tin từ Brave Search.';
      }

      if (isTokenRelated) {
        try {
          const twitterResponse = await axios.post(
            `${process.env.NEXTAUTH_URL}/api/twitter-search`,
            {
              query: prompt,
              tokenSymbol: effectiveTokenSymbol,
            }
          );
          searchContext += `\n### Thông tin Twitter/X\n${twitterResponse.data.message}\n`;
          if (twitterResponse.data.success && twitterResponse.data.tweets?.length > 0) {
            searchContext += twitterResponse.data.tweets
              .map(
                (tweet) =>
                  `- @${tweet.author} (${tweet.verified ? 'Đã xác minh' : 'Chưa xác minh'}): "${tweet.text.slice(
                    0,
                    100
                  )}..." (${tweet.likes} lượt thích, ${tweet.retweets} lượt chia sẻ)`
              )
              .join('\n');
            links = links.concat(twitterResponse.data.tweets.map((tweet) => tweet.link));
          }
        } catch (twitterError) {
          logger.error(`Lỗi tìm kiếm Twitter: ${twitterError.message}`);
          searchContext += '\n### Thông tin Twitter/X\nKhông thể lấy dữ liệu Twitter/X.';
        }
      }
    }

    const aiPrompt = `
Trả lời bằng giọng điệu tự nhiên, chuyên nghiệp (250-300 từ cho phân tích/dự đoán, ngắn gọn cho câu hỏi chung) sử dụng Markdown với **đậm**, *nghiêng* và bảng. Bao gồm *không phải lời khuyên đầu tư* cho các câu hỏi tài chính. Thêm liên kết dạng [text](url).

**Dữ liệu**:
- Phân tích Token: ${tokenAnalysis}
- Tương tác gần đây: ${recentInteractions || 'Không có'}
- Ngữ cảnh tìm kiếm: ${searchContext}

**Hướng dẫn**:
- Với câu hỏi tài chính (ví dụ: phân tích, dự đoán), sử dụng dữ liệu gần đây (chỉ số kinh tế, xu hướng thị trường chứng khoán, tin tức chính trị).
- Với câu hỏi chung, trả lời ngắn gọn, mang tính trò chuyện mà không có phân tích tài chính trừ khi được yêu cầu.
- Tạo bảng cho so sánh hoặc dữ liệu có cấu trúc (ví dụ: khả năng, chỉ số kinh tế).
- Nếu có mã, thêm **Giải thích** ngắn (2-3 câu) và lệnh cài đặt thư viện.

**Câu hỏi**: ${prompt.replace(/[<>{}]/g, '')}
    `.slice(0, 2000);

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-3',
        messages: [
          {
            role: 'system',
            content:
              'Bạn là Grok, một trợ lý AI hữu ích được tạo bởi xAI. Trả lời với dữ liệu chính xác, mới nhất bằng giọng điệu chuyên nghiệp.',
          },
          { role: 'user', content: aiPrompt },
        ],
        temperature: 0.6,
        max_tokens: 1500,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      logger.error(`Lỗi API xAI: ${JSON.stringify(data)}`);
      if (response.status === 429) {
        return NextResponse.json(
          { detail: 'Vượt quá giới hạn API xAI, vui lòng thử lại sau.' },
          { status: 429 }
        );
      }
      throw new Error(data.error?.message || 'Lỗi từ API xAI');
    }

    if (!data.choices?.[0]?.message?.content) {
      logger.error(`Phản hồi API xAI không hợp lệ: ${JSON.stringify(data)}`);
      throw new Error('Không có phản hồi hợp lệ từ Grok');
    }

    return NextResponse.json({
      answer: data.choices[0].message.content,
      links: deepSearch ? links.slice(0, 5) : [],
    });
  } catch (error) {
    logger.error(`Lỗi Grok: ${error.message}`);
    return NextResponse.json(
      { detail: 'Không thể nhận phản hồi từ Grok.' },
      { status: 500 }
    );
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10kb',
    },
  },
};