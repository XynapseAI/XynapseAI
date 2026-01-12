'use client'
import { useEffect, useRef, useState } from 'react'
import Header from '@/components/page/header'
import Footer from '@/components/page/footer'
import CrystalBackground from '@/components/page/crystal-background'
import MainContent from '@/components/page/main-content'
import LeftSparkles from '@/components/page/left-sparkles'

export default function Home() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const videoRef = useRef(null)
  const idleTimeoutRef = useRef(null)

  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePos({ x: e.clientX, y: e.clientY })

      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.play()
      }

      // Reset timer idle
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current)
      }

      idleTimeoutRef.current = setTimeout(() => {
        if (videoRef.current && !videoRef.current.paused) {
          videoRef.current.pause()
        }
      }, 100)
    }

    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      // Cleanup timer khi component unmount
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = 0.4
    }
  }, [])

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      {/* Background Effects */}
      <div className="hidden md:block absolute inset-0 z-0">
        <CrystalBackground mousePos={mousePos} />
      </div>

      <div className="hidden md:block absolute right-0 top-0 bottom-0 w-1/2 lg:w-2/5 z-10 pointer-events-none">
        <video
          ref={videoRef}
          loop
          muted
          playsInline
          className="w-full h-full object-contain scale-70"
        >
          <source src="/intro.webm" type="video/webm" />
        </video>
      </div>

      <LeftSparkles />

      {/* Content Container */}
      <div className="relative z-20 w-full h-screen flex flex-col">
        <Header />
        <MainContent mousePos={mousePos} />
        <Footer />
      </div>
    </div>
  )
}
