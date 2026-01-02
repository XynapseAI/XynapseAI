'use client'

import { useState, useEffect } from 'react'

export default function TypingEffect({
  text = '',
  speed = 100,
  loop = false,
  cursorWidth = '2px',
  cursorHeight = '1rem',
  cursorColor = '#fff',
}) {
  const [displayedText, setDisplayedText] = useState('')
  const [showCursor, setShowCursor] = useState(true)

  useEffect(() => {
    if (!text) return

    let index = 0
    const typingInterval = setInterval(() => {
      if (index < text.length) {
        setDisplayedText(text.slice(0, index + 1))
        index++
      } else {
        clearInterval(typingInterval)
        if (loop) {
          setTimeout(() => {
            setDisplayedText('')
            index = 0
          }, 2000)
        }
      }
    }, speed)

    return () => clearInterval(typingInterval)
  }, [text, speed, loop])

  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setShowCursor((prev) => !prev)
    }, 500)

    return () => clearInterval(cursorInterval)
  }, [])

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
  )
}
