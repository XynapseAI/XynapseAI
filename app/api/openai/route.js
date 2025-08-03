// app/api/openai/route.js
import axios from 'axios';
import { braveSearch } from '../../../utils/braveSearch.js';
import { auth } from '@/lib/auth';
import { verifyRecaptcha } from '../../../utils/verifyRecaptcha.js';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import winston from 'winston';
import { NextResponse } from 'next/server';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  handler: () => {
    return NextResponse.json(
      { detail: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
      { status: 429 }
    );
  },
});

const validate = [
  body('prompt').isString().isLength({ min: 1, max: 1000 }),
  body('deepSearch').optional().isBoolean(),
  body('tokenSymbol').optional().isString().isLength({ max: 10 }),
  body('recaptchaToken').isString(),
];

export async function POST(req) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  logger.info(`Yêu cầu đến /api/openai từ IP ${ip}`);

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
    logger.warn('Không xác thực được phiên');
    return NextResponse.json({ detail: 'Chưa đăng nhập' }, { status: 401 });
  }

  const body = await req.json();
  await Promise.all(validate.map((validation) => validation.run({ body })));
  const errors = validationResult({ body });
  if (!errors.isEmpty()) {
    logger.warn(`Lỗi xác thực: ${JSON.stringify(errors.array())}`);
    return NextResponse.json({ errors: errors.array() }, { status: 400 });
  }

  const { prompt, deepSearch = false, tokenSymbol, recaptchaToken } = body;

  try {
    await verifyRecaptcha(recaptchaToken, 'chat', ip);
    logger.info('Xác minh reCAPTCHA thành công cho hành động: chat');
  } catch (error) {
    logger.error(`Xác minh reCAPTCHA thất bại: ${error.message}`);
    return NextResponse.json(
      { detail: 'Xác minh reCAPTCHA thất bại. Vui lòng thử lại.' },
      { status: 403 }
    );
  }

  try {
    logger.info('Xử lý yêu cầu OpenAI:', { prompt, deepSearch, tokenSymbol });

    const isTokenRelated =
      tokenSymbol || prompt.match(/bitcoin|eth|sol|ada|xrp|doge|crypto|token|coin|blockchain/i);
    const effectiveTokenSymbol =
      tokenSymbol || prompt.match(/bitcoin|eth|sol|ada|xrp|doge/i)?.[0]?.toUpperCase() || 'BTC';

    let tokenAnalysis = '';
    let links = [];
    if (isTokenRelated) {
      try {
        const analysisResponse = await axios.post(
          `${process.env.NEXTAUTH_URL}/api/token-analysis`,
          { tokenSymbol: effectiveTokenSymbol }
        );
        tokenAnalysis = analysisResponse.data.aiAnalysis || 'Không có phân tích mạng xã hội.';
        links = analysisResponse.data.links || [];
        logger.info('Phân tích token:', { tokenAnalysis, links });
      } catch (analysisError) {
        logger.error('Lỗi lấy phân tích token:', analysisError.response?.data || analysisError.message);
        tokenAnalysis = 'Không thể lấy phân tích mạng xã hội.';
      }
    }

    let recentInteractions = '';
    if (session?.user?.id) {
      try {
        const interactions = await axios.get(`${process.env.NEXTAUTH_URL}/api/ai-interaction`, {
          params: { uid: session.user.id, limit: 5 },
          headers: { 'X-Recaptcha-Token': recaptchaToken },
        });
        recentInteractions = interactions.data.interactions
          .map((i) => `Câu hỏi: ${i.query}\nTrả lời: ${i.response}`)
          .join('\n---\n');
        logger.info('Lấy tương tác AI gần đây:', recentInteractions);
      } catch (interactionError) {
        logger.error('Lỗi lấy tương tác AI:', interactionError.response?.data || interactionError.message);
        recentInteractions = 'Không thể lấy tương tác gần đây.';
      }
    }

    const aiPrompt = `
Trả lời câu hỏi sau một cách tự nhiên, ngắn gọn, điều chỉnh độ dài câu trả lời (đơn giản hoặc phức tạp tùy ngữ cảnh), sử dụng Markdown với **đậm**, *nghiêng* và xuống dòng để dễ đọc. Nếu câu hỏi yêu cầu so sánh hoặc phân tích (như "so sánh", "phân tích"), tạo bảng so sánh. Nếu liên quan đến tài chính, ghi *không phải lời khuyên đầu tư*. Nếu có liên kết, thêm vào câu trả lời dạng [text](url).

Nếu câu trả lời có mã, thêm **Giải thích** ngắn (2-3 câu) mô tả chức năng mã, và liệt kê lệnh cài đặt thư viện trong khối mã (e.g. \`\`\`bash\npip install yfinance\n\`\`\`), đảm bảo cú pháp mã đúng.

Dựa trên dữ liệu sau: ${tokenAnalysis} , ${recentInteractions || 'Không có'}

Tìm kiếm web (nếu DeepSearch): Kết hợp thông tin mới nhất.

**Câu hỏi**: ${prompt.replace(/[<>{}]/g, '')}
    `;

    let searchContext = '';
    if (deepSearch) {
      try {
        const { snippets, links: searchLinks } = await braveSearch({
          query: prompt,
          count: 5,
          freshness: 'pm',
        });
        searchContext = snippets || '';
        links = searchLinks;
        logger.info('Ngữ cảnh Brave Search:', { searchContext, links });
      } catch (searchError) {
        logger.error('Lỗi API Brave Search:', searchError.response?.data || searchError.message);
        searchContext = 'Không thể lấy thông tin web.';
      }
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'Bạn là một trợ lý hữu ích. Trả lời với thông tin mới nhất có sẵn.',
          },
          { role: 'user', content: `${searchContext}\n${aiPrompt}` },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = response.data;
    logger.info('Phản hồi OpenAI:', JSON.stringify(data, null, 2));

    if (!data.choices?.[0]?.message?.content) {
      logger.error('Phản hồi OpenAI không hợp lệ:', data);
      throw new Error('Không có phản hồi hợp lệ từ OpenAI');
    }

    return NextResponse.json({
      answer: data.choices[0].message.content,
      links: deepSearch ? links.slice(0, 5) : [],
    });
  } catch (error) {
    logger.error('Lỗi trong /api/openai:', error.response?.data || error.message);
    if (error.response?.status === 429) {
      return NextResponse.json(
        { detail: 'Vượt quá giới hạn API OpenAI. Vui lòng thử lại sau.' },
        { status: 429 }
      );
    }
    return NextResponse.json(
      {
        detail: error.response?.data?.error?.message || 'Không thể nhận phản hồi từ OpenAI.',
      },
      { status: error.response?.status || 500 }
    );
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15kb',
    },
  },
};