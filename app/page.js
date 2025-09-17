"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useInView, useScroll, useTransform } from "framer-motion"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls, Sphere, Float, Environment, Stars, Torus } from "@react-three/drei"
import { ArrowUpRight } from "lucide-react"
import Lenis from "@studio-freight/lenis"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { MotionPathPlugin } from "gsap/MotionPathPlugin"
import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import Image from "next/image"
import "../styles/pages.css"

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin)

// Animated Counter Component
function AnimatedCounter({ value, duration = 2000, suffix = "" }) {
  const [count, setCount] = useState(0)
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })

  useEffect(() => {
    if (isInView) {
      let startTime = null
      const animate = (currentTime) => {
        if (startTime === null) startTime = currentTime
        const progress = Math.min((currentTime - startTime) / duration, 1)
        const easeOutQuart = 1 - Math.pow(1 - progress, 4)
        setCount(Math.floor(easeOutQuart * value))
        if (progress < 1) {
          requestAnimationFrame(animate)
        }
      }
      requestAnimationFrame(animate)
    }
  }, [isInView, value, duration])

  return (
    <span ref={ref} className="font-roboto font-bold">
      {count.toLocaleString()}
      {suffix}
    </span>
  )
}

// Typing Effect Component
function TypingEffect({ text, speed = 100, className = "" }) {
  const [displayText, setDisplayText] = useState("")
  const [currentIndex, setCurrentIndex] = useState(0)
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-50px" })

  useEffect(() => {
    if (isInView && currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayText((prev) => prev + text[currentIndex])
        setCurrentIndex((prev) => prev + 1)
      }, speed)
      return () => clearTimeout(timeout)
    }
  }, [isInView, currentIndex, text, speed])

  return (
    <span ref={ref} className={className}>
      {displayText}
      {currentIndex < text.length && <span className="animate-pulse">|</span>}
    </span>
  )
}

// Matrix Hover Effect Component
function MatrixHoverEffect({ text, hoverColor = "#00BFFF" }) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <span
      className="relative inline-block transition-all duration-300"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ color: isHovered ? hoverColor : "inherit" }}
    >
      {text}
    </span>
  )
}

// WalletNode Component
function WalletNode({ address, nametag, image, onDrag, position, onSelect }) {
  const truncateAddress = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`
  const displayName = nametag || truncateAddress(address)

  return (
    <div
      className="relative flex items-center justify-center p-2 rounded-2xl border-2 border-gray-400/50 bg-black/10 backdrop-blur-lg transition-all duration-300 cursor-pointer group w-[160px] z-50 hover:bg-black/60"
      style={{ position: "absolute", left: `${position.x}px`, top: `${position.y}px` }}
      onClick={() => onSelect(address)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", address)
      }}
      onDrag={(e) => {
        if (e.clientX && e.clientY) {
          onDrag(e, address)
        }
      }}
    >
      {image && (
        <Image
          src={image || "/placeholder.svg"}
          alt={`${displayName} logo`}
          className="w-5 h-5 rounded-full mr-2"
          width={500}
          height={500}
        />
      )}
      <p className="text-white text-xs font-medium text-center truncate" title={displayName}>
        {displayName}
      </p>
    </div>
  )
}

// Replace the entire ChainLogosHover component with this:
function ChainLogosHover() {
  const containerRef = useRef(null)
  const logosRef = useRef([])

  const chainLogos = [
    { src: "/icons/eth.webp", alt: "Ethereum" },
    { src: "/icons/bitcoin.webp", alt: "Bitcoin" },
    { src: "/icons/solana.webp", alt: "Solana" },
    { src: "/icons/dogecoin.webp", alt: "Dogecoin" },
  ]

  const initialPositions = [
  { x: 30, y: 30 },
  { x: 60, y: 30 },
  { x: 30, y: 60 },
  { x: 60, y: 60 },
]

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseMove = (e) => {
      const rect = container.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      logosRef.current.forEach((logoEl, i) => {
        if (!logoEl) return
        const logoRect = logoEl.getBoundingClientRect()
        const logoCenterX = logoRect.left + logoRect.width / 2 - rect.left
        const logoCenterY = logoRect.top + logoRect.height / 2 - rect.top

        const dx = mouseX - logoCenterX
        const dy = mouseY - logoCenterY
        const dist = Math.sqrt(dx * dx + dy * dy)
        const maxDist = 100
        let force = dist < maxDist ? ((maxDist - dist) / maxDist) * 50 : 0
        const angle = Math.atan2(dy, dx)
        const moveX = -Math.cos(angle) * force  // Negative for repulsion
        const moveY = -Math.sin(angle) * force  // Negative for repulsion

        logoEl.style.transform = `translate(${moveX}px, ${moveY}px)`
      })
    }

    const handleMouseLeave = () => {
      logosRef.current.forEach((logoEl) => {
        if (logoEl) {
          logoEl.style.transform = "translate(0, 0)"
        }
      })
    }

    container.addEventListener("mousemove", handleMouseMove)
    container.addEventListener("mouseleave", handleMouseLeave)

    return () => {
      container.removeEventListener("mousemove", handleMouseMove)
      container.removeEventListener("mouseleave", handleMouseLeave)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[400px] bg-transparent rounded-lg overflow-hidden"
    >
      {chainLogos.map((logo, i) => (
        <div
          key={i}
          ref={(el) => (logosRef.current[i] = el)}
          className="absolute w-32 h-32 transition-transform duration-300 will-change-transform flex items-center justify-center"
          style={{
            left: `${initialPositions[i].x}%`,
            top: `${initialPositions[i].y}%`,
            transform: "translate(-50%, -50%) translate(0, 0)",
          }}
        >
          <div className="w-24 h-24 rounded-full flex items-center justify-center shadow-lg shadow-black/50 backdrop-blur-sm overflow-hidden">
            <Image
              src={logo.src || "/placeholder.svg"}
              alt={logo.alt}
              width={96}
              height={96}
              className="h-18 w-auto opacity-80 hover:opacity-100 transition-opacity duration-300 object-contain"
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// SimulatedTreemap Component
function SimulatedTreemap() {
  const [nodes, setNodes] = useState([
    {
      address: "0x123...abc",
      nametag: "Binance Deposit Wallet",
      image: "/icons/binance.webp",
      position: { x: 150, y: 200 },
    },
    { address: "0x456...def", nametag: "OKX Hot Wallet", image: "/icons/okx.webp", position: { x: -50, y: 150 } },
    { address: "0x789...ghi", nametag: "Bybit Hot Wallet", image: "/icons/bybit.webp", position: { x: -50, y: 250 } },
    { address: "0xabc...123", nametag: "Tether Treasury", image: "/icons/tether.webp", position: { x: 350, y: 100 } },
    {
      address: "0xdef...456",
      nametag: "Binance Hot Wallet",
      image: "/icons/binance.webp",
      position: { x: 350, y: 200 },
    },
    { address: "0xghi...789", nametag: "Coinbase Wallet", image: "/icons/coinbase.webp", position: { x: 350, y: 300 } },
  ])

  const handleDrag = (e, address) => {
    e.preventDefault()
    const nodeIndex = nodes.findIndex((n) => n.address === address)
    if (nodeIndex !== -1) {
      const updatedNodes = [...nodes]
      updatedNodes[nodeIndex].position = {
        x: updatedNodes[nodeIndex].position.x + e.movementX,
        y: updatedNodes[nodeIndex].position.y + e.movementY,
      }
      setNodes(updatedNodes)
    }
  }

  const handleSelect = (address) => {
    console.log(`Selected wallet: ${address}`)
    alert(`Clicked on wallet: ${address}`)
  }

  const getPath = (startX, startY, endX, endY, color, key) => {
    return (
      <path
        key={key}
        d={`M${startX} ${startY} C${startX + 100} ${startY}, ${endX - 100} ${endY}, ${endX} ${endY}`}
        stroke={color}
        strokeWidth="2"
        fill="none"
        strokeDasharray="5,5"
        className="transition-all duration-300"
      />
    )
  }

  return (
    <div className="relative w-full h-[500px] rounded-2xl p-6 mr-4">
      <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
        {nodes.map((node, index) => {
          if (index === 0) return null
          const startNode = nodes[0]
          return getPath(
            startNode.position.x + 60,
            startNode.position.y + 20,
            node.position.x + 60,
            node.position.y + 20,
            index % 2 === 0 ? "#00BFFF" : "#EF4444",
            `path-${node.address}-${index}`
          )
        })}
      </svg>
      {nodes.map((node) => (
        <WalletNode
          key={node.address}
          address={node.address}
          nametag={node.nametag}
          image={node.image}
          position={node.position}
          onDrag={handleDrag}
          onSelect={handleSelect}
        />
      ))}
    </div>
  )
}

function UniverseBackground() {
  const groupRef = useRef(null)
  const starsRef = useRef(null)

  useFrame((state) => {
    if (groupRef.current) {
      const time = state.clock.getElapsedTime()
      groupRef.current.rotation.z = time * 0.01
    }
  })

  useEffect(() => {
    const handleScroll = () => {
      if (groupRef.current) {
        const scrollY = window.scrollY
        groupRef.current.rotation.x = scrollY * 0.0001
        groupRef.current.rotation.y = scrollY * 0.00005
      }
    }

    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <group ref={groupRef}>
      <Stars radius={100} depth={50} count={500} factor={4} saturation={0} fade speed={0.3} />
      <group ref={starsRef}>
        {Array.from({ length: 30 }).map((_, i) => (
          <Float key={i} speed={0.3 + Math.random() * 0.2} rotationIntensity={0.05}>
            <Sphere
              args={[0.03 + Math.random() * 0.02, 8, 8]}
              position={[(Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60]}
            >
              <meshStandardMaterial
                color={Math.random() > 0.7 ? "#FFD700" : "#FFFFFF"}
                emissive={Math.random() > 0.7 ? "#FFD700" : "#FFFFFF"}
                emissiveIntensity={0.4 + Math.random() * 0.3}
                transparent
                opacity={0.7}
              />
            </Sphere>
          </Float>
        ))}
      </group>
      {Array.from({ length: 8 }).map((_, i) => (
        <Float key={`spiral-${i}`} speed={0.2 + i * 0.1} rotationIntensity={0.05}>
          <Torus
            args={[5 + i * 1.5, 0.03, 16, 100]}
            position={[0, 0, -20]}
            rotation={[Math.PI / 2, 0, i * 0.4]}
          >
            <meshStandardMaterial
              color="#00BFFF"
              emissive="#00BFFF"
              emissiveIntensity={0.5 - i * 0.05}
              transparent
              opacity={0.6 - i * 0.05}
            />
          </Torus>
        </Float>
      ))}
      {Array.from({ length: 5 }).map((_, i) => (
        <Float key={`nebula-${i}`} speed={0.2} rotationIntensity={0.05}>
          <Sphere
            args={[6 + Math.random() * 4, 16, 16]}
            position={[(Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80]}
          >
            <meshStandardMaterial
              color={Math.random() > 0.5 ? "#4B0082" : "#8A2BE2"}
              transparent
              opacity={0.15}
              emissive={Math.random() > 0.5 ? "#4B0082" : "#8A2BE2"}
              emissiveIntensity={0.12}
            />
          </Sphere>
        </Float>
      ))}
      <Environment preset="night" />
      <ambientLight intensity={0.25} color="#000033" />
      <pointLight position={[10, 10, 10]} intensity={0.6} color="#FFD700" />
      <pointLight position={[-10, -10, -10]} intensity={0.4} color="#00BFFF" />
    </group>
  )
}

function HeroSection() {
  const { scrollYProgress } = useScroll()
  const heroRef = useRef(null)

  const titleY = useTransform(scrollYProgress, [0, 0.3], [0, -100])
  const subtitleY = useTransform(scrollYProgress, [0, 0.3], [0, -50])
  const buttonsY = useTransform(scrollYProgress, [0, 0.3], [0, -25])
  const backgroundScale = useTransform(scrollYProgress, [0, 0.5], [1, 1.2])

  const floatingAnimation = {
    y: [-10, 10, -10],
    transition: {
      duration: 6,
      repeat: Number.POSITIVE_INFINITY,
      ease: "easeInOut",
    },
  }

  return (
    <section ref={heroRef} className="relative min-h-screen flex items-center justify-center px-6 z-10 overflow-hidden">
      <motion.div
        style={{ scale: backgroundScale }}
        className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-blue-900/20 pointer-events-none"
      />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 30 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-white/80 rounded-full"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              y: [-20, -100, -20],
              opacity: [0, 1, 0],
              scale: [0.5, 1.5, 0.5],
            }}
            transition={{
              duration: 10 + Math.random() * 5,
              repeat: Number.POSITIVE_INFINITY,
              delay: Math.random() * 8,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
      <motion.div className="text-center max-w-6xl mx-auto relative">
        <motion.div style={{ y: titleY }}>
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.5, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="text-5xl md:text-7xl lg:text-8xl font-bold mb-8 leading-tight relative"
          >
            {["UNLOCK", "ON-CHAIN", "INSIGHTS"].map((word, wordIndex) => (
              <motion.div
                key={word}
                initial={{ opacity: 0, y: 100, rotateX: -90 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{
                  duration: 1.2,
                  delay: wordIndex * 0.3,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
                className="block"
              >
                <span
                  className="text-white"
                  style={{
                    background:
                      wordIndex === 1
                        ? "linear-gradient(to right, #60A5FA, #22D3EE)"
                        : "linear-gradient(to right, #FFFFFF, #DBEAFE, #CFFAFE)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  {word.split("").map((letter, letterIndex) => (
                    <motion.span
                      key={letterIndex}
                      initial={{ opacity: 0, y: 50 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.5,
                        delay: wordIndex * 0.3 + letterIndex * 0.05,
                        ease: "easeOut",
                      }}
                      className="inline-block"
                      whileHover={{
                        scale: 1.1,
                        transition: { duration: 0.2 },
                      }}
                      style={{
                        color: "#FFFFFF",
                      }}
                    >
                      {letter}
                    </motion.span>
                  ))}
                </span>
              </motion.div>
            ))}
            <div className="absolute inset-0 bg-gradient-to-r from-blue-400/20 to-cyan-400/20 blur-3xl -z-10" />
          </motion.h1>
        </motion.div>
        <motion.div style={{ y: subtitleY }}>
          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 1.2 }}
            className="text-sm md:text-lg text-white/70 mb-12 max-w-4xl mx-auto leading-relaxed relative"
          >
            <motion.span animate={floatingAnimation} className="inline-block">
              WITH AI PRECISION
            </motion.span>
            <br />
            <motion.span
              animate={{ ...floatingAnimation, transition: { ...floatingAnimation.transition, delay: 1 } }}
              className="inline-block"
            >
              Access comprehensive wallet data, track large organizations, and visualize fund flows in real-time.
            </motion.span>
          </motion.p>
        </motion.div>
        <motion.div
          style={{ y: buttonsY }}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 1.8 }}
          className="flex flex-col sm:flex-row gap-6 justify-center items-center"
        >
          <Link
            href="/dashboard"
            target="_blank"
            className="px-4 py-2 bg-white text-black rounded-xl text-sm font-medium transition-all duration-300 hover:bg-gray-200 flex items-center gap-2"
          >
            <span>LAUNCH APP</span>
            <motion.div
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
            >
              <ArrowUpRight className="w-5 h-5" />
            </motion.div>
          </Link>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 2.5 }}
          className="absolute bottom-2 sm:bottom-8 left-1 transform -translate-x-1/2"
        >
          <motion.div
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            className="flex flex-col items-center gap-2 text-white/50"
          >
            <div className="w-6 h-10 border-2 border-white/30 rounded-full flex justify-center">
              <motion.div
                animate={{ y: [0, 12, 0] }}
                transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                className="w-1 h-3 bg-white/50 rounded-full mt-2"
              />
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  )
}

export default function Home() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [lenis, setLenis] = useState(null)
  const [isProductOpen, setIsProductOpen] = useState(false)
  const [isResourcesOpen, setIsResourcesOpen] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false) // Added mobile menu state
  const [currentLogoIndex, setCurrentLogoIndex] = useState(0)

  useEffect(() => {
    const lenisInstance = new Lenis({
      duration: 1.5,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1.2,
      touchMultiplier: 2,
    })

    setLenis(lenisInstance)

    function raf(time) {
      lenisInstance.raf(time)
      requestAnimationFrame(raf)
    }

    requestAnimationFrame(raf)

    return () => {
      lenisInstance.destroy()
    }
  }, [])

  const partnerLogos = [
    "/logos/logo1.webp",
    "/logos/logo2.webp",
    "/logos/logo3.webp",
    "/logos/logo4.webp",
    "/logos/logo5.webp",
    "/logos/logo6.webp",
    "/logos/logo7.webp",
    "/logos/logo8.webp",
    "/logos/logo9.webp",
    "/logos/logo10.webp",
    "/logos/logo11.webp",
    "/logos/logo12.webp",
    "/logos/logo13.webp",
    "/logos/logo14.webp",
    "/logos/logo15.webp",
    "/logos/logo16.webp",
    "/logos/logo17.webp",
    "/logos/logo18.webp",
    "/logos/logo19.webp",
    "/logos/logo20.webp",
    "/logos/logo21.webp",
    "/logos/logo22.webp",
    "/logos/logo23.webp",
    "/logos/logo24.webp",
    "/logos/logo25.webp",
    "/logos/logo26.webp",
    "/logos/logo27.webp",
    "/logos/logo28.webp",
    "/logos/logo29.webp",
    "/logos/logo30.webp",
    "/logos/logo31.webp",
    "/logos/logo32.webp",
    "/logos/logo33.webp",
    "/logos/logo34.webp",
    "/logos/logo35.webp",
    "/logos/logo36.webp",
    "/logos/logo37.webp",
    "/logos/logo38.webp",
    "/logos/logo39.webp",
    "/logos/logo40.webp",
    "/logos/logo41.webp",
  ]

  const row1Logos = partnerLogos.slice(0, 14)
  const row2Logos = partnerLogos.slice(14, 28)
  const row3Logos = partnerLogos.slice(28, 41)

  const trustedByLogos = [
    "/logos/mempool.webp",
    "/logos/coingecko.webp",
    "/logos/dune.webp",
    "/logos/infura.webp",
    "/logos/logo4.webp",
  ]

  const simulatedTopHolders = [
    { address: "", balance: 1090000, source: "Satoshi Nakamoto.", image: "/icons/bitcoin.webp" },
    { address: "", balance: 632457, source: "MicroStrategy Inc.", image: "/icons/microstrategy.webp" },
    {
      address: "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo",
      balance: 248597,
      source: "Binance Cold Wallet",
      image: "/icons/binance.webp",
    },
    {
      address: "bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2",
      balance: 140574,
      source: "Robinhood Cold Wallet",
      image: "/icons/robinhood.webp",
    },
    {
      address: "3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6",
      balance: 140398,
      source: "Binance Cold Wallet",
      image: "/icons/binance.webp",
    },
    {
      address: "bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97",
      balance: 130010,
      source: "Bitfinex Cold Wallet",
      image: "/icons/bitfinex.webp",
    },
  ]

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden font-saira">
      <div className="fixed inset-0 z-0">
        <Canvas camera={{ position: [0, 0, 5], fov: 75 }} dpr={[1, 2]} performance={{ min: 0.5 }}>
          <UniverseBackground />
          <OrbitControls enableZoom={false} enablePan={false} enableRotate={false} />
        </Canvas>
      </div>
      <header className="w-full py-0.5 px-4 flex justify-between items-center sticky top-0 bg-black/5 backdrop-blur-xs z-50">
        <div className="flex items-center">
          <Image
            src="/logos/logo-landscape.webp"
            alt="Xynapse Logo"
            width={120}
            height={56}
            className="h-12 sm:h-16 w-auto"
            priority
          />
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-10 m-2">
            <div className="relative group">
              <button
                className="text-white text-sm font-medium transition-all duration-300"
                onMouseEnter={() => setIsProductOpen(true)}
                onMouseLeave={() => setIsProductOpen(false)}
              >
                <MatrixHoverEffect text="PRODUCT" hoverColor="#00BFFF" />
              </button>
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={isProductOpen ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="absolute left-[-15px] top-full mt-1 w-48 bg-transparent backdrop-blur-xs"
                onMouseEnter={() => setIsProductOpen(true)}
                onMouseLeave={() => setIsProductOpen(false)}
              >
                {[
                  { name: "About", href: "/docs#about", disabled: false },
                  { name: "Features", href: "/docs#features", disabled: false },
                  { name: "Pricing (Soon)", href: "#", disabled: true },
                  { name: "API (Soon)", href: "#", disabled: true },
                ].map((link) => (
                  <Link
                    key={link.name}
                    href={link.href}
                    target={link.disabled ? "_self" : "_blank"}
                    className={`block px-4 py-2 text-sm transition-all duration-300 ${link.disabled ? "text-gray-600 cursor-not-allowed" : "text-gray-400 hover:text-white"}`}
                  >
                    {link.name}
                  </Link>
                ))}
              </motion.div>
            </div>
            <div className="relative group">
              <button
                className="text-white text-sm font-medium transition-all duration-300"
                onMouseEnter={() => setIsResourcesOpen(true)}
                onMouseLeave={() => setIsResourcesOpen(false)}
              >
                <MatrixHoverEffect text="RESOURCES" hoverColor="#00BFFF" />
              </button>
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={isResourcesOpen ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="absolute left-[-15px] top-full mt-1 w-48 bg-transparent backdrop-blur-xs"
                onMouseEnter={() => setIsResourcesOpen(true)}
                onMouseLeave={() => setIsResourcesOpen(false)}
              >
                {[
                  { name: "Brand Kit", href: "/docs#brandkit", disabled: false },
                  { name: "Contact", href: "/docs#contact", disabled: false },
                  { name: "Docs", href: "/docs#docs", disabled: false },
                ].map((link) => (
                  <Link
                    key={link.name}
                    href={link.href}
                    target="_blank"
                    className="block px-4 py-2 text-sm text-gray-400 hover:text-white transition-all duration-300"
                  >
                    {link.name}
                  </Link>
                ))}
              </motion.div>
            </div>
          </div>
          {/* Mobile Menu Button */}
          <div className="md:hidden">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="text-white text-[9px] font-medium transition-all duration-300 relative w-3 h-3"
            >
              <span
                className={`hamburger-icon ${isMobileMenuOpen ? 'open' : ''}`}
              ></span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 rounded-l-xl z-50 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="fixed right-0 top-0 w-3/5 h-full bg-black/70 backdrop-blur-sm border-l border-white/10 rounded-l-xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-white text-xl font-bold mb-6"
            >
              ✕
            </button>
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-white mb-4 tracking-wider">PRODUCT</h3>
                {[
                  { name: "About", href: "/docs#about", disabled: false },
                  { name: "Features", href: "/docs#features", disabled: false },
                  { name: "Pricing (Soon)", href: "#", disabled: true },
                  { name: "API (Soon)", href: "#", disabled: true },
                ].map((link) => (
                  <Link
                    key={link.name}
                    href={link.href}
                    target={link.disabled ? "_self" : "_blank"}
                    className={`block text-xs mb-2 transition-all duration-300 ${link.disabled ? "text-gray-600 cursor-not-allowed" : "text-gray-400 hover:text-white"}`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {link.name}
                  </Link>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-bold text-white mb-4 tracking-wider">RESOURCES</h3>
                {[
                  { name: "Brand Kit", href: "/docs#brandkit", disabled: false },
                  { name: "Contact", href: "/docs#contact", disabled: false },
                  { name: "Docs", href: "/docs#docs", disabled: false },
                ].map((link) => (
                  <Link
                    key={link.name}
                    href={link.href}
                    target="_blank"
                    className="block text-xs text-gray-400 mb-2 hover:text-white transition-all duration-300"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {link.name}
                  </Link>
                ))}
              </div>
              <div className="flex gap-6">
                <Link href="https://x.com" className="text-gray-500 hover:text-white transition-colors">
                  <Image
                    src="/logos/x.webp"
                    alt="X Logo"
                    width={24}
                    height={24}
                    className="h-5 w-auto"
                  />
                </Link>
                <span>
                  <Image
                    src="/logos/discord.webp"
                    alt="Discord Logo"
                    width={24}
                    height={24}
                    className="h-6 w-auto opacity-50"
                  />
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <HeroSection />
      <section className="py-16 bg-gray-900/20 relative z-10">
        <p className="text-center text-gray-400 text-sm font-bold mb-12 tracking-wider">
          DATA PROVIDED BY TOP BLOCKCHAIN ANALYSTS
        </p>
        <div className="flex flex-col items-center justify-center">
          <motion.div
            key={currentLogoIndex}
            initial={{ opacity: 0, x: currentLogoIndex > 0 ? -200 : 200, scale: 0.5 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: currentLogoIndex > 0 ? 200 : -200, scale: 0.5 }}
            transition={{ duration: 0.4, type: "spring", stiffness: 400, damping: 20 }}
            className="mb-8 flex justify-center"
          >
            <Image
              src={trustedByLogos[currentLogoIndex] || "/placeholder.svg"}
              alt="Trusted Partner"
              width={192}
              height={192}
              className="h-40 sm:h-56 opacity-60 hover:opacity-100 transition-opacity duration-300 object-contain"
            />
          </motion.div>
          <div className="flex gap-4">
            <button
              onClick={() => setCurrentLogoIndex((prev) => (prev > 0 ? prev - 1 : trustedByLogos.length - 1))}
              className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-all duration-300 flex items-center justify-center"
            >
              <ChevronLeft className="w-6 h-6 text-white" />
            </button>
            <button
              onClick={() => setCurrentLogoIndex((prev) => (prev < trustedByLogos.length - 1 ? prev + 1 : 0))}
              className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-all duration-300 flex items-center justify-center"
            >
              <ChevronRight className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
      </section>

      <section className="py-16 bg-gray-900/20 border-y border-white/5 relative z-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col lg:flex-row items-center gap-12">
          <div className="lg:w-1/2 text-center lg:text-left">
            <h3 className="text-2xl sm:text-3xl font-bold text-white mb-4 tracking-tight">
              On-chain data on EVM, Bitcoin, Solana, Doge chains
            </h3>
            <p className="text-gray-400 text-sm leading-relaxed">
              Monitor real-time data on leading blockchains with advanced AI analytics.
            </p>
          </div>
          <div className="lg:w-1/2">
            <ChainLogosHover />
          </div>
        </div>
      </section>

      <section className="py-20 flex flex-col items-center relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h3 className="text-xl sm:text-2xl font-bold text-white mb-6 tracking-tight">WHY XYNAPSE ANALYTICS?</h3>
          <p className="text-sm text-gray-400 max-w-2xl mx-auto">
            <TypingEffect
              text="Comprehensive on-chain tools to track wallets, holdings, and flows with unparalleled accuracy."
              speed={50}
            />
          </p>
        </motion.div>
        <div className="w-full max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-12 sm:h-14 w-12 sm:w-14 text-white transition-colors duration-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                    />
                  </svg>
                ),
                text: "Wallet Balance & Value Tracking",
              },
              {
                icon: (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-12 sm:h-14 w-12 sm:w-14 text-white transition-colors duration-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                  </svg>
                ),
                text: "Over 500K Name Tags & Labels",
              },
              {
                icon: (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-12 sm:h-14 w-12 sm:w-14 text-white transition-colors duration-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                ),
                text: "Top Holders & Organization Insights",
              },
              {
                icon: (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-12 sm:h-14 w-12 sm:w-14 text-white transition-colors duration-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10h6m-6 0H3m12 0h6M5 7h14" />
                  </svg>
                ),
                text: "Fund Flow Visualization via Network Graph",
              },
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                viewport={{ once: true }}
                className="flex flex-col items-center p-6 bg-gray-900/30 backdrop-blur-lg border border-white/20 rounded-lg hover:border-white/40 transition-all duration-300 group"
                whileHover={{ scale: 1.05 }}
              >
                {item.icon}
                <p className="text-sm text-white text-center font-medium mt-4">{item.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      <section className="py-20 bg-gradient-to-b from-black/20 to-gray-900/20 backdrop-blur-xs relative overflow-hidden z-10">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h3 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">ON-CHAIN INTELLIGENCE</h3>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">
              Real-time wallet and transaction data across multiple chains with AI-enhanced analysis
            </p>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            {[
              {
                title: "WALLETS MONITORED",
                value: 2847392,
                suffix: "+",
                description: "On-chain wallets tracked in real-time",
              },
              {
                title: "NAME TAGS COVERED",
                value: 500000,
                suffix: "+",
                description: "Extensive labeling for addresses and entities",
              },
              {
                title: "ORGANIZATIONS",
                value: 100,
                suffix: "+",
                description: "On-chain information of large organizations",
              },
            ].map((stat, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, delay: index * 0.2 }}
                viewport={{ once: true }}
                className="text-center p-8 bg-gray-900/50 border border-white/20 rounded-lg backdrop-blur-lg hover:border-white/40 transition-all duration-300"
              >
                <div className="text-2xl sm:text-3xl font-bold text-white mb-2">
                  <AnimatedCounter value={stat.value} suffix={stat.suffix} />
                </div>
                <h4 className="text-sm font-bold text-gray-400 mb-3 tracking-wider">{stat.title}</h4>
                <p className="text-xs text-gray-500">{stat.description}</p>
              </motion.div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
            >
              <h4 className="text-2xl font-bold text-white mb-6">REAL-TIME ON-CHAIN MONITORING</h4>
              <ul className="space-y-4">
                {[
                  "Multi-chain wallet tracking",
                  "Large entity movement detection",
                  "Token holder analysis",
                  "Fund inflow/outflow visualization",
                ].map((item, index) => (
                  <motion.li
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    viewport={{ once: true }}
                    className="flex items-center text-gray-500"
                  >
                    <div className="w-2 h-2 bg-white rounded-full mr-4"></div>
                    {item}
                  </motion.li>
                ))}
              </ul>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
              className="relative"
            >
              <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6 backdrop-blur-lg">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm text-gray-400">ETHEREUM</span>
                  <span className="text-sm text-white font-roboto">$4,347.32</span>
                </div>
                <div className="h-32 relative">
                  <svg className="w-full h-full" viewBox="0 0 400 120">
                    <polyline
                      points="10,100 50,80 100,60 150,90 200,40 250,70 300,20 350,50 390,10"
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className="animate-pulse"
                    />
                    <circle cx="390" cy="10" r="3" fill="white" className="animate-ping" />
                  </svg>
                </div>
                <div className="text-xs text-gray-500 mt-2">Live on-chain data with AI insights</div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
      <section className="py-20 bg-black/30 backdrop-blur-sm relative z-10">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h3 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">
              ADVANCED ON-CHAIN ANALYTICS
            </h3>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">
              AI algorithms to dissect wallet patterns and entity behaviors
            </p>
          </motion.div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-16">
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
              className="space-y-8 relative"
            >
              <div className="bg-gray-900/30 border-t border-l border-r border-white/20 rounded-t-lg p-2 backdrop-blur-lg overflow-x-auto relative">
                <div className="flex justify-center items-center p-2 border-b border-white/10 bg-white/5">
                  <h4 className="text-xs font-bold text-white text-center uppercase tracking-wider flex items-center gap-2">
                    Top 100
                    <Image src="/logos/bitcoin.webp" alt="BTC logo" className="w-4 h-4" width={500} height={500} />
                    Holders
                  </h4>
                </div>
                <div className="relative">
                  <table className="w-full text-[9px] sm:text-[11px]">
                    <thead className="top-0 z-10 border-b border-white/10 bg-white/5">
                      <tr>
                        <th className="px-3 py-1.5 text-white text-left font-semibold">
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-5 w-5 stroke-white/60 fill-none"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                              />
                            </svg>
                            Address/Name
                          </div>
                        </th>
                        <th className="px-3 py-1.5 text-white text-left font-semibold">
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-5 w-5 fill-white/60"
                              viewBox="0 0 24 24"
                            >
                              <path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V6h18v12zm-10-8h-2v2H7v2h2v2h2v-2h2v-2h-2v-2z" />
                            </svg>
                            Balance
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {simulatedTopHolders.map((holder, index) => (
                        <motion.tr
                          key={index}
                          className="border-t border-white/10 hover:bg-white/5 transition-all duration-300"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: index * 0.02 }}
                        >
                          <td className="px-4 py-3 text-white">
                            <div className="flex items-center gap-3 group relative">
                              <Image
                                src={holder.image || "/placeholder.svg"}
                                alt={`${holder.source} logo`}
                                className="w-5 h-5 rounded-lg"
                                width={500}
                                height={500}
                              />
                              <span
                                className="text-white font-medium cursor-pointer hover:text-white/80 transition-colors"
                                title={holder.address}
                              >
                                {holder.source || holder.address.slice(0, 6) + "..." + holder.address.slice(-4)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-bold text-white">
                            <span className="px-2 py-1 rounded-lg">{holder.balance.toLocaleString("en-US")}</span>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="absolute bottom-1 left-0 right-0 w-full h-20 bg-gradient-to-t from-black to-transparent pointer-events-none"></div>
                </div>
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
              className="grid grid-cols-2 gap-6"
            >
              {[
                { label: "ACTIVE WATCHLISTS", value: 247 },
                { label: "DATA ACCURACY", value: 99, suffix: "%" },
                { label: "CHAINS SUPPORTED", value: 65 },
                { label: "DAILY QUERIES", value: 1834 },
              ].map((item, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.8 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  viewport={{ once: true }}
                  className="bg-gray-900/50 border border-white/20 rounded-lg p-6 text-center backdrop-blur-lg hover:border-white/40 transition-all duration-300"
                >
                  <div className="text-3xl font-bold text-white mb-2">
                    <AnimatedCounter value={item.value} suffix={item.suffix || ""} />
                  </div>
                  <div className="font-bold text-xs text-gray-400 tracking-wider">{item.label}</div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>
      <section className="py-20 bg-gradient-to-b from-gray-900/30 to-black/30 backdrop-blur-sm relative z-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
              className="relative"
            >
              <SimulatedTreemap />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
            >
              <h3 className="text-3xl sm:text-4xl font-bold text-white mb-8 tracking-tight">OUR VISION</h3>
              <ul className="space-y-6">
                {[
                  "Empower users with deep on-chain insights into wallets and entities",
                  "Provide real-time tracking of large organizations and top holders",
                  "Enable seamless watchlists and treemap-based flow analysis",
                ].map((item, index) => (
                  <motion.li
                    key={index}
                    initial={{ opacity: 0, x: 20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.6, delay: index * 0.2 }}
                    viewport={{ once: true }}
                    className="flex items-start text-gray-500"
                  >
                    <div className="w-2 h-2 bg-white rounded-full mr-4 mt-2 flex-shrink-0"></div>
                    <span className="text-base leading-relaxed">{item}</span>
                  </motion.li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </section>
      <section className="py-20 bg-black/10 backdrop-blur-xs m-10 sm:m-52 relative z-10">
        <div className="text-center mb-20">
          <p className="text-xl sm:text-1xl font-bold text-gray-400 tracking-wider">
            COMPREHENSIVE DATA ACROSS 65+ BLOCKCHAINS
          </p>
        </div>
        <div className="relative w-full overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-4 sm:w-32 bg-gradient-to-r from-black to-transparent z-10"></div>
          <div className="absolute inset-y-0 right-0 w-4 sm:w-32 bg-gradient-to-l from-black to-transparent z-10"></div>
          <div className="flex animate-marquee-right-to-left mb-8">
            {[...row1Logos, ...row1Logos].map((logo, index) => (
              <Image
                key={`row1-${index}`}
                src={logo || "/placeholder.svg"}
                alt="Blockchain Partner"
                width={80}
                height={80}
                className="h-14 sm:h-16 mx-4 sm:mx-8 opacity-60 hover:opacity-100 transition-opacity duration-200 object-contain"
              />
            ))}
          </div>
          <div className="flex animate-reverse-marquee mb-8">
            {[...row2Logos, ...row2Logos].map((logo, index) => (
              <Image
                key={`row2-${index}`}
                src={logo || "/placeholder.svg"}
                alt="Blockchain Partner"
                width={80}
                height={80}
                className="h-14 sm:h-16 mx-4 sm:mx-8 opacity-60 hover:opacity-100 transition-opacity duration-200 object-contain"
              />
            ))}
          </div>
          <div className="flex animate-marquee-right-to-left">
            {[...row3Logos, ...row3Logos].map((logo, index) => (
              <Image
                key={`row3-${index}`}
                src={logo || "/placeholder.svg"}
                alt="Blockchain Partner"
                width={80}
                height={80}
                className="h-14 sm:h-16 mx-4 sm:mx-8 opacity-60 hover:opacity-100 transition-opacity duration-200 object-contain"
              />
            ))}
          </div>
        </div>
      </section>
      <footer className="py-16 bg-black/30 backdrop-blur-xs relative z-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
            <div>
              <div className="flex items-center mb-4">
                <Image
                  src="/logos/logo-landscape.webp"
                  alt="Xynapse Analytics Logo"
                  width={120}
                  height={56}
                  className="h-12 sm:h-16 w-auto"
                />
              </div>
            </div>
            {[
              {
                title: "PRODUCT",
                links: [
                  { name: "Features", href: "/docs#features", disabled: false },
                  { name: "Pricing (Soon)", href: "#", disabled: true },
                  { name: "API (Soon)", href: "#", disabled: true },
                ],
              },
              {
                title: "RESOURCES",
                links: [
                  { name: "About", href: "/docs#about", disabled: false },
                  { name: "Brand Kit", href: "/docs#brandkit", disabled: false },
                  { name: "Contact", href: "/docs#contact", disabled: false },
                  { name: "Docs", href: "/docs#docs", disabled: false },
                ],
              },
              {
                title: "CONTACT",
                links: [{ name: "Email: mail.xynapse@gmail.com", href: "mailto:mail.xynapse@gmail.com", disabled: false }],
              },
            ].map((col, index) => (
              <div key={index}>
                <h3 className="text-sm font-bold text-white mb-4 tracking-wider">{col.title}</h3>
                {col.links.map((link) => (
                  <Link
                    key={link.name}
                    href={link.href}
                    target={link.disabled ? "_self" : "_blank"}
                    className={`block text-xs mb-2 transition-all duration-300 ${link.disabled ? "text-gray-600 cursor-not-allowed" : "text-gray-500 hover:text-white"}`}
                  >
                    <MatrixHoverEffect text={link.name} hoverColor={link.disabled ? "#4B5563" : "#00BFFF"} />
                  </Link>
                ))}
              </div>
            ))}
          </div>
          <div className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-white/20">
            <div className="flex gap-6 mb-4 md:mb-0">
              <Link href="https://x.com" target="_blank" className="text-gray-500 hover:text-white transition-colors">
                <Image src="/logos/x.webp" alt="X Logo" width={24} height={24} className="h-5 sm:h-6 w-auto" />
              </Link>
              <span>
                <Image
                  src="/logos/discord.webp"
                  alt="Discord Logo"
                  width={24}
                  height={24}
                  className="h-5 sm:h-6 w-auto opacity-50"
                />
              </span>
            </div>
          </div>
          <p className="text-center text-xs text-gray-500 mt-8">
            Copyright © 2025 Xynapse Analytics. All rights reserved.
          </p>
        </div>
      </footer>
      <style jsx>{`
        @keyframes marquee-right-to-left {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes reverse-marquee {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
        .animate-marquee-right-to-left {
          animation: marquee-right-to-left 30s linear infinite;
        }
        .animate-reverse-marquee {
          animation: reverse-marquee 35s linear infinite;
        }
        .hamburger-icon {
          display: block;
          width: 24px;
          height: 2px;
          background: white;
          position: relative;
          left: 0;
          transition: all 0.3s ease;
        }
        .hamburger-icon::before,
        .hamburger-icon::after {
          content: '';
          position: absolute;
          width: 24px;
          height: 2px;
          background: white;
          left: 0;
          transition: all 0.3s ease;
        }
        .hamburger-icon::before {
          top: -8px;
        }
        .hamburger-icon::after {
          top: 8px;
        }
        .hamburger-icon.open {
          background: transparent;
        }
        .hamburger-icon.open::before {
          transform: rotate(45deg);
          top: 0;
        }
        .hamburger-icon.open::after {
          transform: rotate(-45deg);
          top: 0;
        }
      `}</style>
    </div>
  )
}