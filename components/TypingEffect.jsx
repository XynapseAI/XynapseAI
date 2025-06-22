// components/TypingEffect.jsx
'use client';

import { useState, useEffect } from 'react';

export default function TypingEffect({
  text = '', // Đặt giá trị mặc định là chuỗi rỗng để tránh undefined
  speed = 100,
  loop = false,
  cursorWidth = '2px',
  cursorHeight = '1rem',
  cursorColor = '#fff',
}) {
  const [displayedText, setDisplayedText] = useState('');
  const [showCursor, setShowCursor] = useState(true);

  // Hiệu ứng đánh chữ
  useEffect(() => {
    if (!text) return; // Nếu text rỗng, không chạy hiệu ứng

    let index = 0;
    const typingInterval = setInterval(() => {
      if (index < text.length) {
        setDisplayedText(text.slice(0, index + 1)); // Sử dụng slice để tránh cộng chuỗi không mong muốn
        index++;
      } else {
        clearInterval(typingInterval); // Dừng interval khi hoàn thành
        if (loop) {
          setTimeout(() => {
            setDisplayedText('');
            index = 0;
          }, 2000); // Chờ 2s trước khi lặp lại nếu loop = true
        }
      }
    }, speed);

    return () => clearInterval(typingInterval);
  }, [text, speed, loop]);

  // Hiệu ứng nhấp nháy cursor
  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 500); // Nhấp nháy mỗi 0.5s

    return () => clearInterval(cursorInterval);
  }, []);

  return (
    <span>
      {displayedText}
      <span
        className={`inline-block ${showCursor ? 'opacity-100' : 'opacity-0'}`}
        style={{
          width: cursorWidth,
          height: cursorHeight,
          backgroundColor: cursorColor,
          marginLeft: '2px',
          verticalAlign: 'middle',
        }}
      />
    </span>
  );
}