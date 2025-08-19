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
    <span ref={ref} className="font-mono font-bold">
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
        cardsContainerRef.current.style.minHeight = `${cardHeight * 1.4 + 150}px`
      }
      if (sectionRef.current) {
        sectionRef.current.style.minHeight = `${viewportHeight * 1.2}px`
        sectionRef.current.style.marginTop = isMobile ? "-10vh" : "0"
      }

      gsap.set([card1Ref.current, card2Ref.current, card3Ref.current], {
        opacity: 0,
        y: 150,
        scale: isMobile ? 0.95 : 0.9,
        width: cardWidth,
        height: cardHeight,
        overwrite: "auto",
      })

      const cardTl = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: isMobile ? "top 10%" : "top 20%",
          end: isMobile ? `+=${viewportHeight * 1.5}` : `+=${viewportHeight * 2}`,
          scrub: 0.5,
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
            duration: isMobile ? 0.8 : 1,
            ease: "power3.out",
          },
          0,
        )
        .to(
          card2Ref.current,
          {
            opacity: 1,
            y: isMobile ? cardHeight * 0.2 : 20,
            scale: 1,
            duration: isMobile ? 0.8 : 1,
            ease: "power3.out",
          },
          isMobile ? 0.3 : 0.5,
        )
        .to(
          card3Ref.current,
          {
            opacity: 1,
            y: isMobile ? cardHeight * 0.4 : 40,
            scale: 1,
            duration: isMobile ? 0.8 : 1,
            ease: "power3.out",
          },
          isMobile ? 0.6 : 1,
        )

      // Stars and meteors animation
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
          star.className = "star"
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
      title: "Grok AI",
      description:
        "Harness the power of Grok, created by xAI, to deliver unparalleled market predictions and deep crypto analytics with real-time precision.",
      image: "/logos/grok.png",
    },
    {
      title: "Gemini AI",
      description:
        "Leverage Gemini’s advanced reasoning capabilities to uncover hidden market trends and optimize your crypto investment strategies.",
      image: "/logos/gemini.png",
    },
    {
      title: "ChatGPT AI",
      description:
        "Utilize ChatGPT’s natural language processing to analyze social sentiment and generate actionable insights for market movements.",
      image: "/logos/gpt.png",
    },
  ]

  const partnerLogos = [
    '/logos/logo1.png',
    '/logos/logo2.png',
    '/logos/logo3.png',
    '/logos/logo4.png',
    '/logos/logo5.png',
    '/logos/logo6.png',
    '/logos/logo7.png',
    '/logos/logo8.png',
    '/logos/logo9.png',
    '/logos/logo10.png',
    '/logos/logo11.png',
    '/logos/logo12.png',
    '/logos/logo13.png',
    '/logos/logo14.png',
    '/logos/logo15.png',
    '/logos/logo16.png',
    '/logos/logo17.png',
    '/logos/logo18.png',
    '/logos/logo19.png',
    '/logos/logo20.png',
    '/logos/logo21.png',
    '/logos/logo22.png',
    '/logos/logo23.png',
    '/logos/logo24.png',
    '/logos/logo25.png',
    '/logos/logo26.png',
    '/logos/logo27.png',
    '/logos/logo28.png',
    '/logos/logo29.png',
    '/logos/logo30.png',
    '/logos/logo31.png',
    '/logos/logo32.png',
    '/logos/logo33.png',
    '/logos/logo34.png',
    '/logos/logo35.png',
    '/logos/logo36.png',
    '/logos/logo37.png',
    '/logos/logo38.png',
    '/logos/logo39.png',
    '/logos/logo40.png',
    '/logos/logo41.png',
  ]

  const row1Logos = partnerLogos.slice(0, 14)
  const row2Logos = partnerLogos.slice(14, 28)
  const row3Logos = partnerLogos.slice(28, 41)

  const trustedByLogos = [
    '/logos/logo1.png',
    '/logos/logo2.png',
    '/logos/logo3.png',
    '/logos/logo4.png',
    '/logos/logo5.png',
  ]

  return (
    <div className="min-h-screen flex flex-col bg-black text-white overflow-x-hidden font-saira">
      {/* Header */}
      <header className="w-full py-1.5 px-6 flex justify-between items-center z-50 sticky top-0">
        <div className="flex items-center">
          <Image
            src="/logos/logo-landscape.png"
            alt="Xynapse Logo"
            width={120}
            height={56}
            className="h-14 sm:h-20 w-auto"
            priority
          />
        </div>
        <div className="flex items-center gap-4">
          <Link href="https://x.com" className="transition-all duration-300">
            <Image
              src="/logos/x.png"
              alt="X Logo"
              width={24}
              height={24}
              className="h-4 sm:h-5 w-auto"
            />
          </Link>
          <span>
            <Image
              src="/logos/discord.png"
              alt="Discord Logo"
              width={24}
              height={24}
              className="h-4 sm:h-5 w-auto opacity-50"
            />
          </span>
          <Link
            href="/dashboard"
            className="px-3 py-1.5 text-white text-xs border border-white/20 rounded-md font-medium transition-all duration-300"
          >
            <MatrixHoverEffect text="LAUNCH APP" hoverColor="#00BFFF" />
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="min-h-screen flex flex-col items-center justify-center py-16 bg-gradient-to-b from-black via-gray-900 to-black relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center z-10 max-w-4xl mx-auto px-6"
        >
          <h1 className="text-2xl sm:text-3xl md:text-7xl font-bold text-white mb-6 tracking-tight">
            MASTER THE MARKET
            <br />
            <span className="text-gray-400">WITH AI</span>
          </h1>
          <p className="text-[11px] sm:text-sm text-gray-400 mb-8 max-w-2xl mx-auto leading-relaxed">
            Unlock real-time insights, predictive analytics, and social sentiment analysis powered by elite AI models.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="#learn-more"
              className="px-4 py-2 text-white border border-white/20 rounded-md text-xs font-medium transition-all duration-300"
            >
              <MatrixHoverEffect text="DISCOVER NOW" hoverColor="#00BFFF" />
            </Link>
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-white text-black rounded-md text-xs font-medium transition-all duration-300 hover:bg-gray-200"
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
          TRUSTED BY TOP CRYPTO INNOVATORS
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
      <section ref={sectionRef} className="py-16 flex flex-col items-center relative z-50">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-16 text-center tracking-tight">
          <TypingEffect text="POWERED BY ELITE AI MODELS" speed= {150} />
        </h2>
        <div ref={cardsContainerRef} className="relative flex items-start justify-center pt-8">
          {[card1Ref, card2Ref, card3Ref].map((ref, index) => (
            <motion.div
              key={index}
              ref={ref}
              className="absolute bg-gradient-to-br from-gray-900 via-black to-gray-800 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex flex-row items-center justify-between p-8 w-full max-w-4xl sm:h-[300px] h-[240px] hover:border-white/40 transition-all duration-300"
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
              text="Cutting-edge tools to navigate the volatile crypto market with confidence."
              speed={50}
            />
          </p>
        </motion.div>

        <div className="w-full max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { image: "/logos/icon1.png", text: "Real-Time Token Tracking" },
              { image: "/logos/icon2.png", text: "AI-Powered Predictions" },
              { image: "/logos/icon3.png", text: "Social Sentiment Analysis" },
              { image: "/logos/icon4.png", text: "Top Holder Insights" },
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                viewport={{ once: true }}
                className="flex flex-col items-center p-6 bg-gray-900/30 backdrop-blur-lg border border-white/20 rounded-lg hover:border-white/40 transition-all duration-300 hover:scale-105"
                whileHover={{ scale: 1.05 }}
              >
                <Image
                  src={item.image}
                  alt={item.text}
                  width={56}
                  height={56}
                  className="h-12 sm:h-14 mb-4 object-contain"
                />
                <p className="text-sm text-white text-center font-medium">{item.text}</p>
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
            <h3 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">MARKET INTELLIGENCE</h3>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">
              Real-time data processing across multiple blockchains with AI-driven insights
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            {[
              {
                title: "TRANSACTIONS ANALYZED",
                value: 2847392,
                suffix: "+",
                description: "Cross-chain transactions processed in real-time",
              },
              {
                title: "AI PREDICTIONS",
                value: 94,
                suffix: "%",
                description: "Accuracy rate for market movement predictions",
              },
              {
                title: "ACTIVE TRADERS",
                value: 15847,
                suffix: "",
                description: "Professional traders using our platform daily",
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
              <h4 className="text-2xl font-bold text-white mb-6">REAL-TIME ANALYTICS</h4>
              <ul className="space-y-4">
                {[
                  "Multi-chain transaction monitoring",
                  "Whale movement detection",
                  "Smart contract analysis",
                  "DeFi protocol tracking",
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
                  <span className="text-sm text-white font-mono">$2,847.32</span>
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
                <div className="text-xs text-gray-500 mt-2">Live price feed with AI predictions</div>
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
            <h3 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">ADVANCED ANALYTICS</h3>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">
              Deep learning algorithms analyze market patterns and social sentiment
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-16">
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
              className="space-y-8"
            >
              {[
                {
                  title: "SENTIMENT ANALYSIS",
                  value: 87,
                  description: "Current market sentiment score based on social media analysis",
                },
                {
                  title: "VOLATILITY INDEX",
                  value: 42,
                  description: "Real-time volatility measurement across major cryptocurrencies",
                },
                {
                  title: "TREND STRENGTH",
                  value: 73,
                  description: "AI-calculated trend momentum for optimal entry/exit points",
                },
              ].map((metric, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: index * 0.2 }}
                  viewport={{ once: true }}
                  className="bg-gray-900/30 border border-white/20 rounded-lg p-6 backdrop-blur-lg"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-gray-400 tracking-wider">{metric.title}</h4>
                    <div className="text-2xl font-bold text-white">
                      <AnimatedCounter value={metric.value} suffix="%" />
                    </div>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2 mb-3">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${metric.value}%` }}
                      transition={{ duration: 1.5, delay: index * 0.2 }}
                      viewport={{ once: true }}
                      className="bg-white h-2 rounded-full"
                    />
                  </div>
                  <p className="text-xs text-gray-500">{metric.description}</p>
                </motion.div>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              viewport={{ once: true }}
              className="grid grid-cols-2 gap-6"
            >
              {[
                { label: "ACTIVE SIGNALS", value: 247 },
                { label: "SUCCESS RATE", value: 89, suffix: "%" },
                { label: "CHAINS MONITORED", value: 65 },
                { label: "DAILY ALERTS", value: 1834 },
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
                  <div className="text-xs text-gray-400 tracking-wider">{item.label}</div>
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
              <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6 backdrop-blur-lg">
                <div className="flex items-center gap-3 mb-6">
                  <Image
                    src="/logos/bitcoin.png"
                    alt="Bitcoin Logo"
                    width={40}
                    height={40}
                    className="w-8 h-8 sm:w-10 sm:h-10 object-contain"
                  />
                  <div>
                    <span className="text-white text-sm sm:text-base font-bold uppercase">BITCOIN</span>
                    <div className="text-gray-400 text-sm">BTC</div>
                  </div>
                </div>
                <div className="h-48 relative">
                  <svg className="w-full h-full" viewBox="0 0 400 200">
                    <polyline
                      points="10,180 50,160 100,120 150,180 200,100 250,160 300,80 350,120 390,20"
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <circle cx="390" cy="20" r="4" fill="white" className="animate-pulse" />
                  </svg>
                </div>
              </div>
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
                  "Democratize crypto market intelligence with AI-driven insights",
                  "Empower users with real-time data on CEX/DEX and transactions",
                  "Reward community engagement through integrated activities",
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

      {/* Call to Action */}
      <section className="py-20 bg-black">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h3 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">
              TAKE CONTROL OF THE CRYPTO MARKET
            </h3>
            <p className="text-lg text-gray-500 mb-12 max-w-2xl mx-auto">
              <TypingEffect text="Join savvy traders using AI to stay ahead of market trends." speed={50} />
            </p>
          </motion.div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {["Instant Insights", "AI Automation", "Community Rewards", "Secure Data"].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                viewport={{ once: true }}
                className="p-6 bg-gray-900/30 backdrop-blur-lg border border-white/20 rounded-lg text-center hover:border-white/40 transition-all duration-300 hover:scale-105"
                whileHover={{ scale: 1.05 }}
              >
                <p className="text-sm text-white font-medium">{item}</p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            viewport={{ once: true }}
          >
            <Link
              href="/signup"
              className="inline-block px-8 py-4 bg-white text-black rounded-md text-sm font-medium transition-all duration-300 hover:bg-gray-200"
            >
              <MatrixHoverEffect text="SIGN UP" hoverColor="#000000" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Partners Section */}
      <section className="py-20 bg-black m-32">
        <div className="text-center mb-16">
          <p className="text-xl sm:text-1xl font-bold text-gray-400 tracking-wider">ON-CHAIN DATA ON 65+ CHAINS</p>
        </div>
        <div className="relative w-full overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-black to-transparent z-10"></div>
          <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-black to-transparent z-10"></div>

          <div className="flex animate-marquee-right-to-left mb-8">
            {[...row1Logos, ...row1Logos].map((logo, index) => (
              <Image
                key={`row1-${index}`}
                src={logo}
                alt="Blockchain Partner"
                width={80}
                height={80}
                className="h-16 mx-8 opacity-60 hover:opacity-100 transition-opacity duration-200 object-contain"
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
                className="h-16 mx-8 opacity-60 hover:opacity-100 transition-opacity duration-200 object-contain"
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
                className="h-16 mx-8 opacity-60 hover:opacity-100 transition-opacity duration-200 object-contain"
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
                  src="/logos/logo-landscape.png"
                  alt="Xynapse Logo"
                  width={120}
                  height={56}
                  className="h-12 sm:h-14 w-auto"
                />
              </div>
              <p className="text-xs text-gray-500">Xynapse Analytics © 2025</p>
            </div>

            {[
              { title: "PRODUCT", links: ["Features", "Pricing", "Docs"] },
              { title: "RESOURCES", links: ["Blog", "Support", "Brand Kit"] },
              { title: "COMPANY", links: ["About", "Careers", "Contact"] },
            ].map((col, index) => (
              <div key={index}>
                <h3 className="text-sm font-bold text-white mb-4 tracking-wider">{col.title}</h3>
                {col.links.map((link) => (
                  <Link
                    key={link}
                    href={`/${link.toLowerCase()}`}
                    className="block text-xs text-gray-500 mb-2 transition-all duration-300 hover:text-white"
                  >
                    <MatrixHoverEffect text={link} hoverColor="#00BFFF" />
                  </Link>
                ))}
              </div>
            ))}
          </div>

          <div className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-white/20">
            <div className="flex gap-6 mb-4 md:mb-0">
              <Link href="https://x.com" className="text-gray-500 hover:text-white transition-colors">
                <Image
                  src="/logos/x.png"
                  alt="X Logo"
                  width={24}
                  height={24}
                  className="h-5 sm:h-6 w-auto"
                />
              </Link>
              <span>
                <Image
                  src="/logos/discord.png"
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
        .star {
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