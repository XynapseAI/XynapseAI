'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/page/header'
import Footer from '@/components/page/footer'
import CrystalBackground from '@/components/page/crystal-background'
import MainContent from '@/components/page/main-content'
import LeftSparkles from '@/components/page/left-sparkles'

export default function Home() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePos({ x: e.clientX, y: e.clientY })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      {/* Background Effects */}
      <div className="hidden md:block absolute inset-0 z-0">
        <CrystalBackground mousePos={mousePos} />
      </div>
      <LeftSparkles />

      {/* Content Container */}
      <div className="relative z-10 w-full h-screen flex flex-col">
        <Header />
        <MainContent mousePos={mousePos} />
        <Footer />
      </div>
    </div>
  )
}
