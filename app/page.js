"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useInView } from "framer-motion"
import { useRouter } from "next/navigation"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { MotionPathPlugin } from "gsap/MotionPathPlugin"
import Link from "next/link"
import Image from "next/image"
import '../styles/globals.css'
import '../styles/pages.css'
import { TermsOfServiceContent } from '../components/TermsOfService'
import { PrivacyPolicyContent } from '../components/PrivacyPolicy'

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
      style={{ position: 'absolute', left: `${position.x}px`, top: `${position.y}px` }}
      onClick={() => onSelect(address)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', address)
      }}
      onDrag={(e) => {
        if (e.clientX && e.clientY) {
          onDrag(e, address)
        }
      }}
    >
      {image && (
        <Image
          src={image}
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

// SimulatedTreemap Component
function SimulatedTreemap() {
  const [nodes, setNodes] = useState([
    { address: '0x123...abc', nametag: 'Binance Deposit Wallet', image: '/icons/binance.webp', position: { x: 150, y: 200 } },
    { address: '0x456...def', nametag: 'OKX Hot Wallet', image: '/icons/okx.webp', position: { x: -50, y: 150 } },
    { address: '0x789...ghi', nametag: 'Bybit Hot Wallet', image: '/icons/bybit.webp', position: { x: -50, y: 250 } },
    { address: '0xabc...123', nametag: 'Tether Treasury', image: '/icons/tether.webp', position: { x: 350, y: 100 } },
    { address: '0xdef...456', nametag: 'Binance Hot Wallet', image: '/icons/binance.webp', position: { x: 350, y: 200 } },
    { address: '0xghi...789', nametag: 'Coinbase Wallet', image: '/icons/coinbase.webp', position: { x: 350, y: 300 } },
  ])

  const handleDrag = (e, address) => {
    e.preventDefault()
    const nodeIndex = nodes.findIndex(n => n.address === address)
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

  const getPath = (startX, startY, endX, endY, color) => {
    return (
      <path
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
            index % 2 === 0 ? "#00BFFF" : "#EF4444"
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

export default function Home() {
  const router = useRouter()
  const card1Ref = useRef(null)
  const card2Ref = useRef(null)
  const card3Ref = useRef(null)
  const sectionRef = useRef(null)
  const cardsContainerRef = useRef(null)
  const starsRef = useRef(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalContent, setModalContent] = useState(null)
  const [isProductOpen, setIsProductOpen] = useState(false)
  const [isResourcesOpen, setIsResourcesOpen] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    const path = router.asPath
    if (path === '/privacy-policy') {
      setModalContent('privacy')
      setIsModalOpen(true)
      document.body.style.overflow = 'hidden'
    } else if (path === '/terms-of-service') {
      setModalContent('terms')
      setIsModalOpen(true)
      document.body.style.overflow = 'hidden'
    }
  }, [router.asPath])

  const openModal = (content) => {
    setModalContent(content)
    setIsModalOpen(true)
    document.body.style.overflow = 'hidden'
    router.push(content === 'privacy' ? '/privacy-policy' : '/terms-of-service', undefined, {
      shallow: true,
    })
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setModalContent(null)
    document.body.style.overflow = 'auto'
    router.push('/', undefined, { shallow: true })
  }

  useEffect(() => {
    const initAnimation = () => {
      if (!sectionRef.current || !card1Ref.current || !card2Ref.current || !card3Ref.current) {
        setTimeout(initAnimation, 100)
        return
      }

      ScrollTrigger.getAll().forEach((trigger) => trigger.kill())

      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const isMobile = viewportWidth < 640
      const cardWidth = isMobile ? viewportWidth * 0.9 : Math.min(viewportWidth * 0.8, 1000)
      const cardHeight = isMobile ? viewportHeight * 0.35 : viewportHeight * 0.3

      if (cardsContainerRef.current) {
        cardsContainerRef.current.style.minHeight = `${cardHeight * 3}px`
      }
      if (sectionRef.current) {
        sectionRef.current.style.minHeight = `${viewportHeight * 2}px`
        sectionRef.current.style.marginTop = isMobile ? "-10vh" : "0"
      }

      gsap.set([card1Ref.current, card2Ref.current, card3Ref.current], {
        opacity: 0,
        y: 300,
        scale: isMobile ? 0.95 : 0.9,
        width: cardWidth,
        height: cardHeight,
        xPercent: -50,
        left: "50%",
        overwrite: "auto",
      })

      const cardTl = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: isMobile ? "top 10%" : "top 15%",
          end: isMobile ? `+=${viewportHeight * 3.5}` : `+=${viewportHeight * 4}`,
          scrub: 1.5,
          pin: true,
          pinSpacing: true,
          markers: false,
          immediateRender: true,
          anticipatePin: 1,
        },
      })

      cardTl
        .to(
          card1Ref.current,
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: isMobile ? 1.2 : 1.5,
            ease: "power4.out",
          },
          0
        )
        .to(
          card1Ref.current,
          {
            opacity: 0.2,
            y: -cardHeight * 0.8,
            scale: 0.9,
            duration: isMobile ? 0.8 : 1,
            ease: "power4.in",
          },
          isMobile ? 1.8 : 2.5
        )
        .to(
          card2Ref.current,
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: isMobile ? 1.2 : 1.5,
            ease: "power4.out",
          },
          isMobile ? 1.5 : 2.2
        )
        .to(
          card2Ref.current,
          {
            opacity: 0.2,
            y: -cardHeight * 0.8,
            scale: 0.9,
            duration: isMobile ? 0.8 : 1,
            ease: "power4.in",
          },
          isMobile ? 3.3 : 4.7
        )
        .to(
          card3Ref.current,
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: isMobile ? 1.2 : 1.5,
            ease: "power4.out",
          },
          isMobile ? 3.0 : 4.4
        )
        .to(
          card3Ref.current,
          {
            opacity: 0.2,
            y: -cardHeight * 0.8,
            scale: 0.9,
            duration: isMobile ? 0.8 : 1,
            ease: "power4.in",
          },
          isMobile ? 4.8 : 6.9
        )

      if (starsRef.current) {
        starsRef.current.innerHTML = ""

        const animateStar = (star) => {
          gsap.to(star, {
            left: `${gsap.utils.random(0, 100)}%`,
            top: `${gsap.utils.random(0, 100)}%`,
            opacity: gsap.utils.random(0.3, 0.9),
            duration: gsap.utils.random(50, 100),
            ease: "power1.inOut",
            onComplete: () => animateStar(star),
          })
        }

        const numStars = isMobile ? 8 : 12
        for (let i = 0; i < numStars; i++) {
          const star = document.createElement("div")
          star.className = "star-dot"
          gsap.set(star, {
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            opacity: gsap.utils.random(0.3, 0.9),
          })
          starsRef.current.appendChild(star)
          animateStar(star)
        }

        const createMeteor = () => {
          const meteorContainer = document.createElement("div")
          meteorContainer.className = "meteor-container"
          starsRef.current.appendChild(meteorContainer)

          const meteorTail = document.createElement("div")
          meteorTail.className = "meteor-tail"
          meteorContainer.appendChild(meteorTail)

          const isFromRight = Math.random() > 0.5
          const startX = isFromRight ? gsap.utils.random(70, 90) : gsap.utils.random(10, 30)
          const startY = -10
          const endX = isFromRight ? gsap.utils.random(10, 30) : gsap.utils.random(70, 90)
          const endY = 110

          const angle = (Math.atan2(endY - startY, endX - startX) * 180) / Math.PI + 90

          gsap.set(meteorContainer, {
            x: `${startX}vw`,
            y: `${startY}vh`,
            rotation: angle,
            opacity: 0,
            scale: 1,
            zIndex: 5,
          })

          const duration = gsap.utils.random(3, 5)

          const meteorTl = gsap.timeline({
            onComplete: () => {
              meteorContainer.remove()
              setTimeout(createMeteor, gsap.utils.random(8000, 15000))
            },
          })

          meteorTl
            .to(meteorContainer, {
              opacity: 1,
              duration: duration * 0.2,
              ease: "power1.out",
            })
            .to(
              meteorContainer,
              {
                motionPath: {
                  path: [
                    { x: `${startX}vw`, y: `${startY}vh` },
                    { x: `${endX}vw`, y: `${endY}vh` },
                  ],
                  curviness: 0.3,
                },
                opacity: 0,
                duration: duration * 0.8,
                ease: "power1.in",
              },
              `<${duration * 0.2}`,
            )
            .fromTo(
              meteorTail,
              { scaleY: 0, opacity: 0 },
              {
                scaleY: 1,
                opacity: 0.8,
                duration: duration * 0.3,
                ease: "power1.out",
              },
              `<0`,
            )
            .to(
              meteorTail,
              {
                scaleY: 0,
                opacity: 0,
                duration: duration * 0.7,
                ease: "power1.in",
              },
              `>-0.1`,
            )
        }

        setTimeout(createMeteor, gsap.utils.random(2000, 5000))
      }

      ScrollTrigger.refresh()
    }

    initAnimation()

    const handleResize = () => {
      ScrollTrigger.refresh()
      initAnimation()
    }

    window.addEventListener("resize", handleResize)

    return () => {
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill())
      window.removeEventListener("resize", handleResize)
      document.body.style.overflow = "auto"
    }
  }, [])

  const cardData = [
    {
      title: "Token Flow Intelligence",
      description:
        "Track the movement of new and trending tokens across 65+ blockchains, with AI-driven predictions to identify high-potential assets.",
      image: "/icons/token-flow.svg",
    },
    {
      title: "Whale Wallet Monitoring",
      description:
        "Monitor major wallets in real-time, with AI alerts for significant transactions and holdings.",
      image: "/icons/whale-wallet.svg",
    },
    {
      title: "Fund Flow Visualization",
      description:
        "Visualize capital flows with interactive treemaps, revealing the flow of funds between top holders and exchanges.",
      image: "/icons/treemap.svg",
    },
  ]

  const partnerLogos = [
    '/logos/logo1.webp',
    '/logos/logo2.webp',
    '/logos/logo3.webp',
    '/logos/logo4.webp',
    '/logos/logo5.webp',
    '/logos/logo6.webp',
    '/logos/logo7.webp',
    '/logos/logo8.webp',
    '/logos/logo9.webp',
    '/logos/logo10.webp',
    '/logos/logo11.webp',
    '/logos/logo12.webp',
    '/logos/logo13.webp',
    '/logos/logo14.webp',
    '/logos/logo15.webp',
    '/logos/logo16.webp',
    '/logos/logo17.webp',
    '/logos/logo18.webp',
    '/logos/logo19.webp',
    '/logos/logo20.webp',
    '/logos/logo21.webp',
    '/logos/logo22.webp',
    '/logos/logo23.webp',
    '/logos/logo24.webp',
    '/logos/logo25.webp',
    '/logos/logo26.webp',
    '/logos/logo27.webp',
    '/logos/logo28.webp',
    '/logos/logo29.webp',
    '/logos/logo30.webp',
    '/logos/logo31.webp',
    '/logos/logo32.webp',
    '/logos/logo33.webp',
    '/logos/logo34.webp',
    '/logos/logo35.webp',
    '/logos/logo36.webp',
    '/logos/logo37.webp',
    '/logos/logo38.webp',
    '/logos/logo39.webp',
    '/logos/logo40.webp',
    '/logos/logo41.webp',
  ]

  const row1Logos = partnerLogos.slice(0, 14)
  const row2Logos = partnerLogos.slice(14, 28)
  const row3Logos = partnerLogos.slice(28, 41)

  const trustedByLogos = [
    '/logos/logo1.webp',
    '/logos/logo2.webp',
    '/logos/logo3.webp',
    '/logos/logo4.webp',
    '/logos/logo5.webp',
  ]

  const simulatedTopHolders = [
    { address: '', balance: 1090000, source: 'Satoshi Nakamoto.', image: '/icons/bitcoin.webp' },
    { address: '', balance: 632457, source: 'MicroStrategy Inc.', image: '/icons/microstrategy.webp' },
    { address: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', balance: 248597, source: 'Binance Cold Wallet', image: '/icons/binance.webp' },
    { address: 'bc1ql49ydapnjafl5t2cp9zqpjwe6pdgmxy98859v2', balance: 140574, source: 'Robinhood Cold Wallet', image: '/icons/robinhood.webp' },
    { address: '3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6', balance: 140398, source: 'Binance Cold Wallet', image: '/icons/binance.webp' },
    { address: 'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97', balance: 130010, source: 'Bitfinex Cold Wallet', image: '/icons/bitfinex.webp' },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-black text-white overflow-x-hidden font-saira">
      {/* Header */}
      <header className="w-full py-1.5 px-6 flex justify-between items-center z-50 sticky top-0 bg-black/50 backdrop-blur-lg">
        <div className="flex items-center">
          <Image
            src="/logos/logo-landscape.webp"
            alt="Xynapse Logo"
            width={120}
            height={56}
            className="h-14 sm:h-20 w-auto"
            priority
          />
        </div>
        <div className="flex items-center gap-4">
          {/* Desktop Menu */}
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
                    className={`block px-4 py-2 text-sm transition-all duration-300 ${
                      link.disabled
                        ? "text-gray-600 cursor-not-allowed"
                        : "text-gray-400 hover:text-white"
                    }`}
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
                  // { name: "Blog", href: "/docs#blog", disabled: false },
                  // { name: "Support", href: "/docs#support", disabled: false },
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
            className="fixed right-0 top-0 w-3/5 h-full bg-black/80 backdrop-blur-sm border-l border-white/10 rounded-l-xl p-6"
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
                    className={`block text-xs mb-2 transition-all duration-300 ${
                      link.disabled
                        ? "text-gray-600 cursor-not-allowed"
                        : "text-gray-400 hover:text-white"
                    }`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {link.name}
                  </Link>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-bold text-white mb-4 tracking-wider">RESOURCES</h3>
                {[
                  // { name: "Blog", href: "/docs#blog", disabled: false },
                  // { name: "Support", href: "/docs#support", disabled: false },
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

      {/* Hero Section */}
      <section className="min-h-screen flex flex-col items-center justify-center py-16 bg-gradient-to-b from-black via-gray-900 to-black relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center z-10 max-w-4xl mx-auto px-6"
        >
          <h1 className="text-2xl sm:text-2xl md:text-5xl font-bold text-white mb-6 tracking-tight">
            UNLOCK ON-CHAIN INSIGHTS
            <br />
            <span className="text-gray-400">WITH AI PRECISION</span>
          </h1>
          <p className="text-[11px] sm:text-sm text-gray-400 mb-8 max-w-2xl mx-auto leading-relaxed">
            Access comprehensive wallet data, track large organizations, and visualize fund flows in real-time.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/dashboard"
              target="_blank"
              className="px-4 py-2 bg-white text-black rounded-lg text-xs font-medium transition-all duration-300 hover:bg-gray-200"
            >
              <MatrixHoverEffect text="LAUNCH APP" hoverColor="#000000" />
            </Link>
          </div>
        </motion.div>
        <div ref={starsRef} className="absolute inset-0 z-0" />
      </section>

      {/* Trusted By */}
      <section className="py-16 bg-gray-900/20 border-y border-white/10">
        <p className="text-center text-gray-400 text-sm font-bold mb-12 tracking-wider">
          TRUSTED BY LEADING BLOCKCHAIN ANALYSTS
        </p>
        <div className="w-full overflow-hidden">
          <div className="flex animate-marquee-right-to-left">
            {[...trustedByLogos, ...trustedByLogos].map((logo, index) => (
              <Image
                key={`trusted-${index}`}
                src={logo}
                alt="Trusted Partner"
                width={64}
                height={64}
                className="h-12 sm:h-16 mx-6 opacity-60 hover:opacity-100 transition-opacity duration-300 object-contain"
              />
            ))}
          </div>
        </div>
      </section>

      {/* Powered by Elite AI Models */}
      <section ref={sectionRef} className="py-16 flex flex-col items-center relative">
        <div ref={cardsContainerRef} className="relative flex items-start justify-center pt-8">
          {[card1Ref, card2Ref, card3Ref].map((ref, index) => (
            <motion.div
              key={index}
              ref={ref}
              className="absolute bg-gradient-to-br from-gray-900 via-black to-gray-800 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl flex flex-row items-center justify-between p-8 w-full max-w-4xl sm:h-[300px] h-[240px] transition-all duration-300 card"
            >
              <div className="flex-1 pr-8">
                <h3 className="text-2xl sm:text-3xl font-bold text-white mb-4 tracking-tight">
                  {cardData[index].title}
                </h3>
                <p className="text-sm sm:text-base text-gray-400 leading-relaxed">{cardData[index].description}</p>
              </div>
              <div className="flex-none w-24 h-24">
                <Image
                  src={cardData[index].image}
                  alt={cardData[index].title}
                  width={96}
                  height={96}
                  className="w-full h-full object-contain rounded-lg opacity-80"
                />
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Why Choose Us */}
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
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"
                    />
                  </svg>
                ),
                text: "Over 1M Name Tags & Labels",
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
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 17V7m0 10h6m-6 0H3m12 0h6M5 7h14"
                    />
                  </svg>
                ),
                text: "Fund Flow Visualization via Treemap",
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

      {/* Market Intelligence */}
      <section className="py-20 bg-gradient-to-b from-black to-gray-900 relative overflow-hidden">
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
                value: 1000000,
                suffix: "+",
                description: "Extensive labeling for addresses and entities",
              },
              {
                title: "ACTIVE USERS",
                value: 15847,
                suffix: "",
                description: "Analysts using our platform daily",
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

      {/* Advanced Analytics */}
      <section className="py-20 bg-black relative">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h3 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">ADVANCED ON-CHAIN ANALYTICS</h3>
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
                    <Image
                      src="/logos/bitcoin.webp"
                      alt="BTC logo"
                      className="w-4 h-4"
                      width={500}
                      height={500}
                    />
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
                                src={holder.image}
                                alt={`${holder.source} logo`}
                                className="w-5 h-5 rounded-lg"
                                width={500}
                                height={500}
                              />
                              <span
                                className="text-white font-medium cursor-pointer hover:text-white/80 transition-colors"
                                title={holder.address}
                              >
                                {holder.source || holder.address.slice(0, 6) + '...' + holder.address.slice(-4)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-bold text-white">
                            <span className="px-2 py-1 rounded-lg">
                              {holder.balance.toLocaleString("en-US")}
                            </span>
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

      {/* Our Vision */}
      <section className="py-20 bg-gradient-to-b from-gray-900 to-black relative">
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

      {/* Partners Section */}
      <section className="py-20 bg-black m-20 sm:m-52">
        <div className="text-center mb-20">
          <p className="text-xl sm:text-1xl font-bold text-gray-400 tracking-wider">COMPREHENSIVE DATA ACROSS 65+ BLOCKCHAINS</p>
        </div>
        <div className="relative w-full overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-4 sm:w-32 bg-gradient-to-r from-black to-transparent z-10"></div>
          <div className="absolute inset-y-0 right-0 w-4 sm:w-32 bg-gradient-to-l from-black to-transparent z-10"></div>

          <div className="flex animate-marquee-right-to-left mb-8">
            {[...row1Logos, ...row1Logos].map((logo, index) => (
              <Image
                key={`row1-${index}`}
                src={logo}
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
                src={logo}
                alt="Blockchain Partner"
                width={80}
                height={80}
                className="h-10 sm:h-16 mx-4 sm:mx-8 opacity-60 hover:opacity-100 transition-opacity duration-200 object-contain"
              />
            ))}
          </div>

          <div className="flex animate-marquee-right-to-left">
            {[...row3Logos, ...row3Logos].map((logo, index) => (
              <Image
                key={`row3-${index}`}
                src={logo}
                alt="Blockchain Partner"
                width={80}
                height={80}
                className="h-10 sm:h-16 mx-4 sm:mx-8 opacity-60 hover:opacity-100 transition-opacity duration-200 object-contain"
              />
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 bg-gray-900/50 backdrop-blur-lg border-t border-white/20">
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
                  // { name: "Blog", href: "/docs#blog", disabled: false },
                  // { name: "Support", href: "/docs#support", disabled: false },
                  { name: "About", href: "/docs#about", disabled: false },
                  { name: "Brand Kit", href: "/docs#brandkit", disabled: false },
                  { name: "Contact", href: "/docs#contact", disabled: false },
                  { name: "Docs", href: "/docs#docs", disabled: false },
                ],
              },
              {
                title: "CONTACT",
                links: [
                  { name: "Email", href: "mailto:mail.xynapse@gmail.com", disabled: false },
                ],
              },
            ].map((col, index) => (
              <div key={index}>
                <h3 className="text-sm font-bold text-white mb-4 tracking-wider">{col.title}</h3>
                {col.links.map((link) => (
                  <Link
                    key={link.name}
                    href={link.href}
                    target={link.disabled ? "_self" : "_blank"}
                    className={`block text-xs mb-2 transition-all duration-300 ${
                      link.disabled
                        ? "text-gray-600 cursor-not-allowed"
                        : "text-gray-500 hover:text-white"
                    }`}
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
                <Image
                  src="/logos/x.webp"
                  alt="X Logo"
                  width={24}
                  height={24}
                  className="h-5 sm:h-6 w-auto"
                />
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
            <div className="flex gap-6 text-xs text-gray-500">
              <button
                onClick={() => openModal('terms')}
                className="hover:text-white transition-colors"
              >
                <MatrixHoverEffect text="Terms" hoverColor="#00BFFF" />
              </button>
              <button
                onClick={() => openModal('privacy')}
                className="hover:text-white transition-colors"
              >
                <MatrixHoverEffect text="Privacy" hoverColor="#00BFFF" />
              </button>
            </div>
          </div>

          <p className="text-center text-xs text-gray-500 mt-8">
            Copyright © 2025 Xynapse Analytics. All rights reserved.
          </p>
        </div>
      </footer>

      {/* Modal for Terms and Privacy */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/75 flex items-center justify-center z-50"
          onClick={closeModal}
        >
          <div
            className="bg-gray-900/50 backdrop-blur-lg border border-white/20 rounded-2xl w-full max-w-7xl h-[90vh] relative flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 backdrop-blur-lg border-b border-white/20 p-6 flex justify-between items-center">
              <h1 className="text-2xl sm:text-3xl font-bold text-white uppercase">
                {modalContent === 'privacy'
                  ? 'Xynapse Privacy Policy'
                  : 'Xynapse Terms of Service'}
                <span className="block text-sm sm:text-base text-gray-300 mt-1">
                  Effective Date: June 21, 2025
                </span>
              </h1>
              <button
                onClick={closeModal}
                aria-label="Close modal"
                className="text-white text-xl font-bold hover:text-neon-blue transition-all duration-300"
              >
                ✕
              </button>
            </div>
            <div className="text-xs sm:text-sm flex-1 overflow-y-auto custom-scrollbar p-6 prose prose-invert max-w-none">
              {modalContent === 'privacy' ? <PrivacyPolicyContent /> : <TermsOfServiceContent />}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
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

        .star-dot {
          position: absolute;
          width: 2px;
          height: 2px;
          background: white;
          border-radius: 50%;
          opacity: 0.7;
        }

        .meteor-container {
          position: absolute;
          width: 2px;
          height: 2px;
        }

        .meteor-tail {
          position: absolute;
          width: 2px;
          height: 100px;
          background: linear-gradient(to bottom, white, transparent);
          transform-origin: top center;
        }

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
      `}</style>
    </div>
  )
}