'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import Link from 'next/link';
import MatrixHoverEffect from '../components/MatrixHoverEffect';
import { TermsOfServiceContent } from '../components/TermsOfService';
import { PrivacyPolicyContent } from '../components/PrivacyPolicy';
import TypingEffect from '../components/TypingEffect';
import Image from 'next/image';

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

export default function Home() {
  const router = useRouter();
  const card1Ref = useRef(null);
  const card2Ref = useRef(null);
  const card3Ref = useRef(null);
  const sectionRef = useRef(null);
  const cardsContainerRef = useRef(null);
  const newSectionRef = useRef(null);
  const text1Ref = useRef(null);
  const text2Ref = useRef(null);
  const text3Ref = useRef(null);
  const starsRef = useRef(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);

  useEffect(() => {
    const path = router.asPath;
    if (path === '/privacy-policy') {
      setModalContent('privacy');
      setIsModalOpen(true);
      document.body.style.overflow = 'hidden';
    } else if (path === '/terms-of-service') {
      setModalContent('terms');
      setIsModalOpen(true);
      document.body.style.overflow = 'hidden';
    }
  }, [router.asPath]);

  const openModal = (content) => {
    setModalContent(content);
    setIsModalOpen(true);
    document.body.style.overflow = 'hidden';
    router.push(content === 'privacy' ? '/privacy-policy' : '/terms-of-service', undefined, {
      shallow: true,
    });
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalContent(null);
    document.body.style.overflow = 'auto';
    router.push('/', undefined, { shallow: true });
  };

  useEffect(() => {
    // Variable to keep track of active comets, but the logic is now sequential
    let activeCometTimeout;

    const checkRefs = () => {
      if (
        !sectionRef.current ||
        !card1Ref.current ||
        !card2Ref.current ||
        !card3Ref.current ||
        !cardsContainerRef.current ||
        !newSectionRef.current ||
        !text1Ref.current ||
        !text2Ref.current ||
        !text3Ref.current ||
        !starsRef.current
      ) {
        return false;
      }
      return true;
    };

    const initAnimation = () => {
      if (!checkRefs()) {
        setTimeout(initAnimation, 100);
        return;
      }

      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const isMobile = viewportWidth < 640;
      const cardWidth = isMobile ? viewportWidth * 0.9 : Math.min(viewportWidth * 0.8, 1000);
      const cardHeight = isMobile ? viewportHeight * 0.35 : viewportHeight * 0.3;

      cardsContainerRef.current.style.minHeight = `${cardHeight * 1.4 + 150}px`;
      sectionRef.current.style.minHeight = `${viewportHeight * 1.2}px`;
      sectionRef.current.style.marginTop = isMobile ? '-10vh' : '0';

      gsap.set([card1Ref.current, card2Ref.current, card3Ref.current], {
        opacity: 0,
        y: 150,
        scale: isMobile ? 0.95 : 0.9,
        width: cardWidth,
        height: cardHeight,
        overwrite: 'auto',
      });

      const cardTl = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: isMobile ? 'top 10%' : 'top 20%',
          end: isMobile ? `+=${viewportHeight * 1.5}` : `+=${viewportHeight * 2}`,
          scrub: 0.5,
          pin: true,
          pinSpacing: true,
          markers: false,
          immediateRender: true,
          anticipatePin: 1,
        },
      });

      cardTl
        .to(card1Ref.current, {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: isMobile ? 0.8 : 1,
          ease: 'power3.out',
        }, 0)
        .to(card2Ref.current, {
          opacity: 1,
          y: isMobile ? cardHeight * 0.2 : 20,
          scale: 1,
          duration: isMobile ? 0.8 : 1,
          ease: 'power3.out',
        }, isMobile ? 0.3 : 0.5)
        .to(card3Ref.current, {
          opacity: 1,
          y: isMobile ? cardHeight * 0.4 : 40,
          scale: 1,
          duration: isMobile ? 0.8 : 1,
          ease: 'power3.out',
        }, isMobile ? 0.6 : 1);

      gsap.set([text1Ref.current, text2Ref.current, text3Ref.current], {
        opacity: 0,
        y: isMobile ? 30 : 50,
        overwrite: 'auto',
      });

      const textTl = gsap.timeline({
        scrollTrigger: {
          trigger: newSectionRef.current,
          start: isMobile ? 'top 20%' : 'top top',
          end: isMobile ? `+=${viewportHeight}` : '+=1000',
          pin: true,
          pinSpacing: true,
          scrub: 0.5,
          markers: false,
          immediateRender: true,
        },
      });

      textTl
        .to(text1Ref.current, {
          opacity: 1,
          y: 0,
          duration: isMobile ? 0.8 : 1,
          ease: 'power3.out',
        }, 0)
        .to(text2Ref.current, {
          opacity: 1,
          y: 0,
          duration: isMobile ? 0.8 : 1,
          ease: 'power3.out',
        }, isMobile ? 0.3 : 0.5)
        .to(text3Ref.current, {
          opacity: 1,
          y: 0,
          duration: isMobile ? 0.8 : 1,
          ease: 'power3.out',
        }, isMobile ? 0.6 : 1);

      // Inside the useEffect hook, within initAnimation function
      if (starsRef.current) {
        starsRef.current.innerHTML = ''; // Clear previous stars and comets

        const animateStar = (star) => {
          gsap.to(star, {
            left: `${gsap.utils.random(0, 100)}%`,
            top: `${gsap.utils.random(0, 100)}%`,
            opacity: gsap.utils.random(0.3, 0.9),
            duration: gsap.utils.random(50, 100),
            ease: 'power1.inOut',
            onComplete: () => {
              animateStar(star);
            },
          });
        };

        // Stars (unchanged)
        const numStars = isMobile ? 5 : 8;
        for (let i = 0; i < numStars; i++) {
          const star = document.createElement('div');
          star.className = 'star';
          gsap.set(star, {
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            opacity: gsap.utils.random(0.3, 0.9),
          });
          starsRef.current.appendChild(star);
          animateStar(star);
        }

        // Meteors (replacing comets)
        const createMeteor = () => {
          console.log('Creating new meteor...');
          const meteorContainer = document.createElement('div');
          meteorContainer.className = 'meteor-container';
          starsRef.current.appendChild(meteorContainer);

          // const meteorHead = document.createElement('div');
          // meteorHead.className = 'meteor-head';
          // meteorContainer.appendChild(meteorHead);

          const meteorTail = document.createElement('div');
          meteorTail.className = 'meteor-tail';
          meteorContainer.appendChild(meteorTail);

          // Randomize starting position (top corners)
          const isFromRight = Math.random() > 0.5;
          const startX = isFromRight
            ? gsap.utils.random(70, 90) // Top-right corner
            : gsap.utils.random(10, 30); // Top-left corner
          const startY = -10; // Start above viewport
          const endX = isFromRight
            ? gsap.utils.random(10, 30) // Bottom-left corner
            : gsap.utils.random(70, 90); // Bottom-right corner
          const endY = 110; // End below viewport

          // Calculate angle for rotation
          const angle = Math.atan2(endY - startY, endX - startX) * 180 / Math.PI + 90;

          gsap.set(meteorContainer, {
            x: `${startX}vw`,
            y: `${startY}vh`,
            rotation: angle,
            opacity: 0,
            scale: 1,
            zIndex: 5,
          });

          const duration = gsap.utils.random(3, 5); // Slower duration (3–5 seconds)

          const meteorTl = gsap.timeline({
            onComplete: () => {
              console.log('Meteor animation completed, removing...');
              meteorContainer.remove();
              activeCometTimeout = setTimeout(createMeteor, gsap.utils.random(10000, 20000));
            },
          });

          meteorTl
            .to(meteorContainer, {
              opacity: 1,
              duration: duration * 0.2,
              ease: 'power1.out',
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
                ease: 'power1.in',
              },
              `<${duration * 0.2}`
            )
            .fromTo(
              meteorTail,
              { scaleY: 0, opacity: 0 },
              {
                scaleY: 1,
                opacity: 0.8,
                duration: duration * 0.3,
                ease: 'power1.out',
              },
              `<0`
            )
            .to(
              meteorTail,
              {
                scaleY: 0,
                opacity: 0,
                duration: duration * 0.7,
                ease: 'power1.in',
              },
              `>-0.1`
            );

          return meteorTl;
        };

        // Initialize the first meteor
        if (!activeCometTimeout) {
          activeCometTimeout = setTimeout(() => {
            console.log('Initializing first meteor...');
            createMeteor();
          }, gsap.utils.random(1000, 5000));
        }
      }

      ScrollTrigger.refresh();
    };

    initAnimation();

    window.addEventListener('resize', () => {
      ScrollTrigger.refresh();
      // Clear existing comet timeouts to prevent orphaned animations
      clearTimeout(activeCometTimeout);
      initAnimation(); // Re-initialize animation on resize to adjust positions and reset comets
    });

    return () => {
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      window.removeEventListener('resize', initAnimation);
      clearTimeout(activeCometTimeout); // Clean up on unmount
      document.body.style.overflow = 'auto';
    };
  }, []);

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
  ];

  const row1Logos = partnerLogos.slice(0, 14);
  const row2Logos = partnerLogos.slice(14, 28);
  const row3Logos = partnerLogos.slice(28, 41);

  const trustedByLogos = [
    '/logos/logo1.png',
    '/logos/logo2.png',
    '/logos/logo3.png',
    '/logos/logo4.png',
    '/logos/logo5.png',
  ];

  const cardData = [
    {
      title: 'Grok AI',
      description:
        'Harness the power of Grok, created by xAI, to deliver unparalleled market predictions and deep crypto analytics with real-time precision.',
      image: '/logos/grok.png',
    },
    {
      title: 'Gemini AI',
      description:
        'Leverage Gemini’s advanced reasoning capabilities to uncover hidden market trends and optimize your crypto investment strategies.',
      image: '/logos/gemini.png',
    },
    {
      title: 'ChatGPT AI',
      description:
        'Utilize ChatGPT’s natural language processing to analyze social sentiment on X and generate actionable insights for market movements.',
      image: '/logos/gpt.png',
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-black text-white overflow-x-hidden font-saira">
      {/* Header */}
      <header className="w-full py-1 px-6 flex justify-between items-center bg-gray-900/50 backdrop-blur-lg border-b border-white/10 z-50 sticky top-0">
        <Image
          src="/logos/logo-landscape.png"
          alt="Xynapse Logo"
          width={120} // Approximate width for h-12 (48px) to h-14 (56px)
          height={56}
          className="h-12 sm:h-14 w-auto"
          priority // Add priority for above-the-fold image
        />
        <div className="flex items-center gap-4">
          <Link href="https://x.com" className="transition-all duration-300">
            <Image
              src="/logos/x.png"
              alt="X Logo"
              width={24} // Approximate width for h-5 (20px) to h-6 (24px)
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
          <Link
            href="/dashboard"
            className="px-4 py-2 text-white text-sm border border-white/20 rounded-full font-medium transition-all duration-300 hover:bg-white/10 backdrop-blur-md"
          >
            <MatrixHoverEffect text="Launch App" hoverColor="#00BFFF" />
          </Link>
        </div>
      </header>

      {/* Banner with Stars and Comets */}
      <section className="min-h-screen flex flex-col items-center justify-center py-16 bg-gradient-to-b from-black to-gray-900 relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="text-center z-10"
        >
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-6 uppercase tracking-tight">
            Master the Market with AI
          </h1>
          <p className="text-sm sm:text-base text-gray-500 mb-8 max-w-xl mx-auto">
            Unlock real-time insights, predictive analytics, and social sentiment analysis powered by Grok, Gemini, and ChatGPT.
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="#learn-more"
              className="px-6 py-3 text-white border border-white/20 rounded-full text-sm font-medium transition-all duration-300 hover:bg-white/10 backdrop-blur-md uppercase"
            >
              <MatrixHoverEffect text="Discover Now" hoverColor="#00BFFF" />
            </Link>
            <Link
              href="/dashboard"
              className="px-6 py-3 bg-neon-blue text-black rounded-full text-sm font-medium transition-all duration-300 hover:bg-neon-blue/80 uppercase"
            >
              <MatrixHoverEffect text="Launch App" hoverColor="#FFFFFF" />
            </Link>
          </div>
        </motion.div>
        <div className="absolute inset-0 bg-grid-background opacity-20 z-0" />
        <div ref={starsRef} className="absolute inset-0 z-0" />
      </section>

      {/* Trusted By */}
      <section className="py-12 bg-gray-900/20">
        <p className="text-center text-gray-500 text-1xl sm:text-1xl font-bold mb-8 uppercase">
          Trusted by Top Crypto Innovators
        </p>
        <div className="w-full overflow-hidden">
          <div className="flex animate-marquee-right-to-left">
            {[...trustedByLogos, ...trustedByLogos].map((logo, index) => (
              <Image
                key={`trusted-${index}`}
                src={logo}
                alt="Trusted By Logo"
                width={64} // Approximate width for h-12 (48px) to h-16 (64px)
                height={64}
                className="h-12 sm:h-16 mx-4 sm:mx-6 opacity-80 hover:opacity-100 transition-opacity duration-300 object-contain"
              />
            ))}
          </div>
        </div>
      </section>

      {/* Powered by Elite AI Models */}
      <section ref={sectionRef} className="py-16 flex flex-col items-center relative z-50">
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-12 text-center uppercase">
          <TypingEffect text="Powered by Elite AI Models" speed={150} loop={false} cursorHeight="2rem" />
        </h2>
        <div ref={cardsContainerRef} className="relative flex items-start justify-center pt-8">
          {[card1Ref, card2Ref, card3Ref].map((ref, index) => (
            <motion.div
              key={index}
              ref={ref}
              className="absolute bg-gradient-to-br from-gray-900 via-black to-gray-800 backdrop-blur-md border-2 border-white/20 rounded-xl shadow-card flex flex-row items-center justify-between p-6 w-full max-w-4xl sm:h-[300px] h-[240px]"
            >
              <div className="flex-1 p-4 w-2/4"> {/* Tăng chiều ngang phần text từ w-3/4 thành w-4/5 */}
                <h3 className="text-xl sm:text-xl font-bold text-white mb-4">{cardData[index].title}</h3>
                <p className="text-xs sm:text-xs text-gray-500">{cardData[index].description}</p>
              </div>
              <div className="flex-none w-1/5">
                <Image
                  src={cardData[index].image}
                  alt={cardData[index].title}
                  width={100}
                  height={100}
                  className="w-full h-auto object-contain rounded-lg ml-2"
                />
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Why Choose Us? */}
      <section className="py-16 flex flex-col items-center relative z-10">
        <h3 className="text-2xl sm:text-3xl font-bold text-white mb-6 text-center uppercase">
          Why Xynapse Analytics?
        </h3>
        <p className="text-sm sm:text-base text-gray-500 mb-10 text-center max-w-2xl">
          <TypingEffect text="Cutting-edge tools to navigate the volatile crypto market with confidence." speed={50} loop={false} cursorHeight="1rem" />
        </p>
        <div className="w-[90%] flex flex-row flex-wrap justify-center gap-4">
          {[
            { image: '/logos/icon1.png', text: 'Real-Time Token Tracking' },
            { image: '/logos/icon2.png', text: 'AI-Powered Predictions' },
            { image: '/logos/icon3.png', text: 'Social Sentiment Analysis' },
            { image: '/logos/icon4.png', text: 'Top Holder Insights' },
          ].map((item, index) => (
            <motion.div
              key={index}
              className="flex flex-col items-center p-4 bg-gray-900/30 backdrop-blur-lg border border-white/20 rounded-xl shadow-glow-neon transition-all duration-300 hover:shadow-neon-blue w-[150px] h-[150px] sm:w-[200px] sm:h-[200px]"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.95 }}
            >
              <Image
                src={item.image}
                alt={item.text}
                width={56} // Approximate width for h-12 (48px) to h-14 (56px)
                height={56}
                className="h-12 sm:h-14 mb-4 object-contain"
              />
              <p className="text-[10px] sm:text-sm text-white text-center">{item.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Our Vision */}
      <section ref={newSectionRef} className="min-h-screen flex items-center justify-center relative bg-black py-16">
        <div className="flex flex-col lg:flex-row items-center w-[90%] max-w-6xl gap-8">
          <motion.div
            className="lg:w-1/2 w-full mr-0 sm:mr-10"
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <div className="relative w-full h-[300px] sm:h-[400px]">
              <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
                <Image
                  src="/logos/bitcoin.png"
                  alt="Bitcoin Logo"
                  width={40} // Approximate width for w-8 (32px) to w-10 (40px)
                  height={40}
                  className="w-8 h-8 sm:w-10 sm:h-10 object-contain"
                />
                <div className="flex flex-col">
                  <span className="text-white text-sm sm:text-base font-bold uppercase">Bitcoin</span>
                  <span className="text-gray-500 text-xs sm:text-sm font-medium">BTC</span>
                </div>
              </div>
              <svg className="w-full h-full" viewBox="0 0 400 200">
                <polyline
                  points="10,180 50,160 100,120 150,180 200,100 250,160 300,80 350,120 390,20"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle
                  cx="390"
                  cy="20"
                  r="4"
                  fill="white"
                  className="blinking-dot"
                />
              </svg>
            </div>
          </motion.div>
          <motion.div
            className="lg:w-1/2 w-full"
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h3 className="text-2xl sm:text-3xl font-bold text-white mb-6 uppercase">Our Vision</h3>
            <ul className="space-y-4">
              <li ref={text1Ref} className="text-xs sm:text-base text-gray-500 flex items-start">
                <span className="text-neon-blue mr-2">•</span> Democratize crypto market intelligence with AI-driven insights.
              </li>
              <li ref={text2Ref} className="text-sm sm:text-base text-gray-500 flex items-start">
                <span className="text-neon-blue mr-2">•</span> Empower users with real-time data on CEX/DEX and transactions.
              </li>
              <li ref={text3Ref} className="text-sm sm:text-base text-gray-500 flex items-start">
                <span className="text-neon-blue mr-2">•</span> Reward community engagement through X-integrated activities.
              </li>
            </ul>
          </motion.div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-16 flex flex-col items-center bg-gradient-to-b from-gray-900 to-black">
        <h3 className="text-2xl sm:text-3xl font-bold text-white mb-6 text-center uppercase">
          Take Control of the Crypto Market
        </h3>
        <p className="text-[10px] sm:text-base text-gray-500 mb-10 text-center max-w-2xl">
          <TypingEffect text="Join savvy traders using AI to stay ahead of market trends." speed={50} loop={false} cursorHeight="1rem" />
        </p>
        <div className="w-[90%] flex flex-row flex-wrap justify-center gap-4">
          {['Instant Insights', 'AI Automation', 'Community Rewards', 'Secure Data'].map(
            (item, index) => (
              <motion.div
                key={index}
                className="p-4 bg-gray-900/30 backdrop-blur-lg border border-white/20 rounded-xl shadow-glow-neon text-center transition-all duration-300 hover:shadow-neon-blue w-[160px] h-[80px] sm:w-[200px] sm:h-[100px] flex items-center justify-center"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <p className="text-[10px] sm:text-sm text-white">{item}</p>
              </motion.div>
            )
          )}
        </div>
        <div className="flex gap-4 mt-10">
          <Link
            href="/signup"
            className="px-6 py-3 bg-neon-blue text-black rounded-full text-sm font-medium transition-all duration-300 uppercase shadow-glow-neon hover:bg-neon-blue/80"
          >
            <MatrixHoverEffect text="Sign Up" hoverColor="#FFFFFF" />
          </Link>
        </div>
      </section>

      {/* Partners Section */}
      <section className="min-h-screen flex flex-col items-center justify-center relative bg-black py-16">
        <p className="text-center font-bold text-gray-500 text-2xl sm:text-4xl mb-12 uppercase">
          On-chain data on 65+ chains
        </p>
        <div className="relative w-[90%] max-w-6xl overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-24 sm:w-32 bg-gradient-to-r from-black to-transparent z-10"></div>
          <div className="absolute inset-y-0 right-0 w-24 sm:w-32 bg-gradient-to-l from-black to-transparent z-10"></div>
          <div className="flex animate-marquee-right-to-left">
            {[...row1Logos, ...row1Logos].map((logo, index) => (
              <Image
                key={`row1-${index}`}
                src={logo}
                alt="Partner Logo"
                width={80} // Approximate width for h-20 (80px)
                height={80}
                className="h-20 mx-6 sm:mx-8 opacity-90 hover:opacity-100 transition-opacity duration-200 object-contain"
              />
            ))}
          </div>
          <div className="flex animate-reverse-marquee mt-6">
            {[...row2Logos, ...row2Logos].map((logo, index) => (
              <Image
                key={`row2-${index}`}
                src={logo}
                alt="Partner Logo"
                width={80}
                height={80}
                className="h-20 mx-6 sm:mx-8 opacity-90 hover:opacity-100 transition-opacity duration-200 object-contain"
              />
            ))}
          </div>
          <div className="flex animate-marquee-right-to-left mt-6">
            {[...row3Logos, ...row3Logos].map((logo, index) => (
              <Image
                key={`row3-${index}`}
                src={logo}
                alt="Partner Logo"
                width={80}
                height={80}
                className="h-20 mx-6 sm:mx-8 opacity-90 hover:opacity-100 transition-opacity duration-200 object-contain"
              />
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-gray-900/50 backdrop-blur-lg border-t border-white/20 relative">
        <div className="w-[90%] max-w-10xl mx-auto flex flex-col gap-2">
          {/* Top Section: Logo (Top-Left) */}
          <div className="flex flex-col items-start">
            <Image
              src="/logos/logo-landscape.png"
              alt="Xynapse Logo"
              width={120}
              height={56}
              className="h-12 sm:h-14 w-auto"
            />
            <p className="text-[9px] sm:text-[10px] text-gray-500">Xynapse Analytics © 2025</p>
          </div>

          {/* Navigation Links (Centered) */}
          <div className="w-full flex flex-col items-center grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            {[
              {
                title: 'Product',
                links: ['Features', 'Pricing', 'Docs'],
              },
              {
                title: 'Resources',
                links: ['Blog', 'Support', 'Brand Kit'],
              },
              {
                title: 'Company',
                links: ['About', 'Careers', 'Contact'],
              },
            ].map((col, index) => (
              <div key={index} className="flex flex-col items-center mt-0 sm:mt-10">
                <h3 className="text-sm sm:text-lg font-bold text-white mb-3 uppercase">{col.title}</h3>
                {col.links.map((link) => (
                  <Link
                    key={link}
                    href={`/${link.toLowerCase()}`}
                    className="text-[10px] sm:text-xs text-gray-500 mb-2 transition-all duration-300 hover:text-neon-blue"
                  >
                    <MatrixHoverEffect text={link} hoverColor="#00BFFF" />
                  </Link>
                ))}
              </div>
            ))}
          </div>

          {/* Social Links and Terms/Privacy (Centered) */}
          <div className="flex flex-col items-center gap-4 mt-4">
            <div className="flex gap-4">
              <Link href="https://x.com">
                <Image
                  src="/logos/x.png"
                  alt="X"
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
            <div className="flex gap-4">
              <button
                onClick={() => openModal('terms')}
                className="text-[10px] sm:text-xs text-gray-500 transition-all duration-300 hover:text-neon-blue"
              >
                <MatrixHoverEffect text="Terms" hoverColor="#00BFFF" />
              </button>
              <button
                onClick={() => openModal('privacy')}
                className="text-[10px] sm:text-xs text-gray-500 transition-all duration-300 hover:text-neon-blue"
              >
                <MatrixHoverEffect text="Privacy" hoverColor="#00BFFF" />
              </button>
            </div>
          </div>

          {/* Copyright (Bottom-Centered) */}
          <p className="text-center text-[10px] sm:text-sm text-gray-500 mt-4">
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
    </div>
  );
}