// app\docs\page.js
"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import '../../styles/globals.css'
import '../../styles/pages.css'
import { TermsOfServiceContent } from '../../components/TermsOfService'
import { PrivacyPolicyContent } from '../../components/PrivacyPolicy'

export default function Docs() {
    const router = useRouter()
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [modalContent, setModalContent] = useState(null)
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
    const [activeSection, setActiveSection] = useState("about")

    // Handle modal for Terms and Privacy and URL hash for section navigation
    useEffect(() => {
        if (typeof window === 'undefined') return; // Skip on server-side

        const path = window.location.pathname + window.location.hash; // Fix: Use window.location instead of router.asPath (not available in next/navigation)
        if (path.includes('privacy-policy')) {
            setModalContent('privacy')
            setIsModalOpen(true)
            document.body.style.overflow = 'hidden'
        } else if (path.includes('terms-of-service')) {
            setModalContent('terms')
            setIsModalOpen(true)
            document.body.style.overflow = 'hidden'
        } else if (path.includes('#')) {
            const hash = path.split('#')[1]
            if (hash && ['about', 'docs', 'support', 'features', 'brandkit', 'contact', 'use-cases', 'api', 'community'].includes(hash)) {
                setActiveSection(hash)
            }
        }
    }, []) // Fix: Run once on mount; listen to hash changes if needed (add event listener if dynamic)

    const openModal = (content) => {
        setModalContent(content)
        setIsModalOpen(true)
        document.body.style.overflow = 'hidden'
        router.push(content === 'privacy' ? '/docs#privacy-policy' : '/docs#terms-of-service', { shallow: true })
    }

    const closeModal = () => {
        setIsModalOpen(false)
        setModalContent(null)
        document.body.style.overflow = 'auto'
        router.push('/docs', { shallow: true })
    }

    // Updated menu items with new sections
    const menuItems = [
        { name: "About", id: "about", href: "/docs#about", disabled: false },
        { name: "Features", id: "features", href: "/docs#features", disabled: false },
        { name: "Use Cases", id: "use-cases", href: "/docs#use-cases", disabled: false },
        { name: "Community", id: "community", href: "/docs#community", disabled: false },
        { name: "Brand Kit", id: "brandkit", href: "/docs#brandkit", disabled: false },
        { name: "Contact", id: "contact", href: "/docs#contact", disabled: false },
        { name: "API (Soon)", id: "api", href: "/docs#api", disabled: true },
        { name: "Pricing (Soon)", id: "pricing", href: "#", disabled: true },
    ]

    // Expanded content for each section
    const sectionContent = {
        about: (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="space-y-8"
            >
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">About Xynapse</h1>
                <p className="text-sm sm:text-base text-gray-500 leading-relaxed">
                    Xynapse Analytics is a cutting-edge blockchain intelligence platform designed to empower users with deep insights into on-chain activities. Launched in 2025, our mission is to bridge the gap between complex blockchain data and actionable decision-making for traders, analysts, institutions, and crypto enthusiasts.
                </p>
                <p className="text-sm sm:text-base text-gray-500 leading-relaxed">
                    Powered by advanced AI and ML, Xynapse tracks over 1 million wallet addresses across 65+ blockchains, offering real-time data on token movements, wallet balances, and capital flows. Our proprietary name-tagging system labels wallets of major entities like Binance, Tether Treasury, and DeFi protocols, providing unparalleled transparency into the crypto ecosystem.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Our Mission</h3>
                        <p className="text-sm text-gray-500">
                            To democratize blockchain analytics, making on-chain data accessible, understandable, and actionable for users worldwide.
                        </p>
                    </div>
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Our Technology</h3>
                        <p className="text-sm text-gray-500">
                            Built on AI-driven models and multi-chain integration, Xynapse delivers real-time insights, interactive visualizations, and predictive analytics to uncover high-potential opportunities in the crypto market.
                        </p>
                    </div>
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Our Reach</h3>
                        <p className="text-sm text-gray-500">
                            Supporting 65+ blockchains, including Ethereum, Solana, Binance Smart Chain, and more, with over 1 million labeled addresses and growing.
                        </p>
                    </div>
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Our Community</h3>
                        <p className="text-sm text-gray-500">
                            Join thousands of analysts, traders, and developers in our X and Discord communities to share insights and stay ahead in the crypto space.
                        </p>
                    </div>
                </div>
            </motion.div>
        ),
        features: (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="space-y-8"
            >
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">Features</h1>
                <p className="text-sm sm:text-base text-gray-500 leading-relaxed">
                    Xynapse Analytics equips you with a powerful suite of tools to navigate the blockchain landscape with confidence. From real-time wallet tracking to AI-driven insights, our platform is designed to give you an edge in the fast-paced world of crypto.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Real-Time Wallet Tracking</h3>
                        <p className="text-sm text-gray-500">
                            Monitor wallet balances, token holdings, and transaction histories across 65+ blockchains with sub-second updates.
                        </p>
                    </div>
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Fund Flow Visualization</h3>
                        <p className="text-sm text-gray-500">
                            Visualize capital flows between wallets, exchanges, and DeFi protocols using interactive treemaps and sankey diagrams.
                        </p>
                    </div>
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Name Tag & Label Database</h3>
                        <p className="text-sm text-gray-500">
                            Access over 1 million labeled wallet addresses, including major entities like Binance, Tether, and whale accounts.
                        </p>
                    </div>
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">AI-Powered Insights</h3>
                        <p className="text-sm text-gray-500">
                            Leverage AI to detect wallet patterns, predict market trends, and receive real-time alerts on significant on-chain activities.
                        </p>
                    </div>
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Top Holder Analysis</h3>
                        <p className="text-sm text-gray-500">
                            Track the behavior of top token holders and institutions like MicroStrategy, Grayscale, and DeFi protocols.
                        </p>
                    </div>
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Multi-Chain Support</h3>
                        <p className="text-sm text-gray-500">
                            Analyze data across major blockchains like Ethereum, Solana, Polygon, and more, all in one unified platform.
                        </p>
                    </div>
                </div>
            </motion.div>
        ),
        "use-cases": (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="space-y-8"
            >
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">Use Cases</h1>
                <p className="text-sm sm:text-base text-gray-500 leading-relaxed">
                    Xynapse Analytics serves a wide range of users, from individual traders to institutional investors, by providing tailored tools for blockchain analysis. Explore how our platform can empower your crypto journey.
                </p>
                <div className="space-y-6">
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Crypto Traders</h3>
                        <p className="text-sm text-gray-500">
                            Monitor whale movements and capital flows to identify trading opportunities. Use AI-driven alerts to stay ahead of market trends and make informed decisions.
                        </p>
                    </div>
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">DeFi Analysts</h3>
                        <p className="text-sm text-gray-500">
                            Track liquidity pools, protocol interactions, and wallet activities to uncover high-yield opportunities and assess DeFi protocol health.
                        </p>
                    </div>
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Institutional Investors</h3>
                        <p className="text-sm text-gray-500">
                            Analyze top holder behavior and on-chain fund flows to inform portfolio strategies and mitigate risks in crypto investments.
                        </p>
                    </div>
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Blockchain Developers</h3>
                        <p className="text-sm text-gray-500">
                            Integrate Xynapse’s API to access real-time blockchain data, enabling the creation of advanced dApps and analytics tools.
                        </p>
                    </div>
                    <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-white mb-2">Compliance Teams</h3>
                        <p className="text-sm text-gray-500">
                            Use name tags and wallet labels to monitor suspicious activities and ensure compliance with regulatory requirements.
                        </p>
                    </div>
                </div>
            </motion.div>
        ),
        docs: (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="space-y-8"
            >
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">Documentation</h1>
                <p className="text-sm sm:text-base text-gray-500 leading-relaxed">
                    Our comprehensive documentation empowers you to harness the full potential of Xynapse Analytics. Whether you`&apos;`re a beginner or an advanced user, our guides provide step-by-step instructions to navigate our platform and leverage its features.
                </p>
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">Getting Started</h3>
                        <p className="text-sm text-gray-500">
                            Set up your account, explore the dashboard, and start tracking wallets and token movements in minutes.
                        </p>
                        <Link href="/docs/getting-started" target="_blank" className="text-neon-blue text-sm hover:underline">
                            Read Getting Started Guide
                        </Link>
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">API Reference</h3>
                        <p className="text-sm text-gray-500">
                            Integrate Xynapse’s real-time on-chain data into your applications with our developer-friendly API. Access wallet data, name tags, and transaction histories programmatically.
                        </p>
                        {/* <Link href="https://x.ai/api" target="_blank" className="text-neon-blue text-sm hover:underline">
                            Explore API Docs
                        </Link> */}
                    </div>
                    {/* <div>
                        <h3 className="text-lg font-semibold text-white mb-2">Tutorials</h3>
                        <p className="text-sm text-gray-500">
                            Learn how to set up watchlists, analyze whale movements, and create custom visualizations with our in-depth tutorials.
                        </p>
                        <Link href="/docs/tutorials" target="_blank" className="text-neon-blue text-sm hover:underline">
                            View Tutorials
                        </Link>
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">Data Interpretation Guide</h3>
                        <p className="text-sm text-gray-500">
                            Understand how to interpret on-chain data, name tags, and fund flow visualizations to make informed decisions.
                        </p>
                        <Link href="/docs/data-guide" target="_blank" className="text-neon-blue text-sm hover:underline">
                            Read Data Guide
                        </Link>
                    </div> */}
                </div>
            </motion.div>
        ),
        api: (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="space-y-8"
            >
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">API</h1>
                <p className="text-sm sm:text-base text-gray-500 leading-relaxed">
                    The Xynapse API enables developers to integrate our real-time blockchain data into their applications, unlocking powerful analytics for dApps, trading bots, and custom dashboards.
                </p>
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">API Overview</h3>
                        <p className="text-sm text-gray-500">
                            Access wallet balances, transaction histories, name tags, and fund flow data across 65+ blockchains with a single, secure API.
                        </p>
                        <Link href="https://x.ai/api" target="_blank" className="text-neon-blue text-sm hover:underline">
                            View API Documentation
                        </Link>
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">Key Endpoints</h3>
                        <ul className="text-sm text-gray-500 list-disc list-inside space-y-2">
                            <li><strong>Wallet Data:</strong> Retrieve real-time balances and token holdings for any address.</li>
                            <li><strong>Transaction History:</strong> Access detailed transaction records with timestamps and counterparties.</li>
                            <li><strong>Name Tags:</strong> Query our database of over 1 million labeled addresses.</li>
                            <li><strong>Fund Flows:</strong> Analyze capital movements between wallets and exchanges.</li>
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">Developer Support</h3>
                        <p className="text-sm text-gray-500">
                            Join our developer community on Discord for API support, code samples, and integration tips.
                        </p>
                        <Link href="https://discord.gg/wrCznU5b2y" target="_blank" className="text-neon-blue text-sm hover:underline">
                            Join Discord Community
                        </Link>
                    </div>
                </div>
            </motion.div>
        ),
        support: (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="space-y-8"
            >
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">Support</h1>
                <p className="text-sm sm:text-base text-gray-500 leading-relaxed">
                    Our dedicated support team is committed to helping you succeed with Xynapse Analytics. Whether you need technical assistance, have questions about features, or want to share feedback, we’re here for you.
                </p>
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">FAQs</h3>
                        <p className="text-sm text-gray-500">
                            Find answers to common questions about account setup, data interpretation, and platform navigation.
                        </p>
                        <Link href="/docs/support/faqs" target="_blank" className="text-neon-blue text-sm hover:underline">
                            Browse FAQs
                        </Link>
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">Contact Support</h3>
                        <p className="text-sm text-gray-500">
                            Reach our support team via email or our dedicated portal for personalized assistance.
                        </p>
                        <a href="mailto:mail.xynapse@gmail.com" className="text-neon-blue text-sm hover:underline">
                            Email: mail.xynapse@gmail.com
                        </a>
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">Community Support</h3>
                        <p className="text-sm text-gray-500">
                            Connect with our global community of blockchain analysts and traders on X and Discord to share insights and get help.
                        </p>
                        <div className="flex gap-4">
                            <Link href="https://x.com/xynapseai_" target="_blank" className="text-neon-blue text-sm hover:underline">
                                Join X Community
                            </Link>
                            <Link href="https://discord.gg/wrCznU5b2y" target="_blank" className="text-neon-blue text-sm hover:underline">
                                Join Discord
                            </Link>
                        </div>
                    </div>
                </div>
            </motion.div>
        ),
        community: (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="space-y-8"
            >
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">Community</h1>
                <p className="text-sm sm:text-base text-gray-500 leading-relaxed">
                    Join the Xynapse Analytics community to connect with thousands of crypto enthusiasts, traders, and developers. Share insights, discuss on-chain trends, and stay updated with the latest platform developments.
                </p>
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">X Community</h3>
                        <p className="text-sm text-gray-500">
                            Follow us on X for real-time updates, on-chain analysis, and exclusive content from our team and community.
                        </p>
                        <Link href="https://x.com/xynapseai_" target="_blank" className="text-neon-blue text-sm hover:underline">
                            Join X Community
                        </Link>
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">Discord Community</h3>
                        <p className="text-sm text-gray-500">
                            Engage with our vibrant Discord community to collaborate on analytics, share trading strategies, and get support.
                        </p>
                        <Link href="https://discord.gg/wrCznU5b2y" target="_blank" className="text-neon-blue text-sm hover:underline">
                            Join Discord
                        </Link>
                    </div>
                </div>
            </motion.div>
        ),
        pricing: (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="space-y-8"
            >
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">Pricing</h1>
                <p className="text-sm sm:text-base text-gray-500 leading-relaxed">
                    Our pricing plans are coming soon! Designed for individual analysts, traders, and enterprise teams, our plans will offer flexible access to Xynapse’s powerful analytics tools.
                </p>
                <div className="bg-gray-900/50 border border-white/20 rounded-lg p-6 text-center">
                    <p className="text-sm text-gray-500">
                        Sign up for updates to be the first to know when our pricing plans are available.
                    </p>
                    <Link href="/docs#contact" className="text-neon-blue text-sm hover:underline">
                        Contact Us for Updates
                    </Link>
                </div>
            </motion.div>
        ),
        brandkit: (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="space-y-8"
            >
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">Brand Kit</h1>
                <p className="text-sm sm:text-base text-gray-500 leading-relaxed">
                    The Xynapse Analytics Brand Kit provides official assets and guidelines to ensure consistent representation of our brand across media, partnerships, and promotional materials.
                </p>
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">Brand Guidelines</h3>
                        <p className="text-sm text-gray-500">
                            Learn how to use Xynapse’s logos, colors, and typography correctly to maintain brand consistency.
                        </p>
                        <a href="/brand-guidelines.pdf" target="_blank" className="text-neon-blue text-sm hover:underline">
                            Download Brand Guidelines (Coming Soon)
                        </a>
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">Logos & Assets</h3>
                        <p className="text-sm text-gray-500">
                            Access high-resolution logos, icons, and other assets for use in your projects.
                        </p>
                        <a href="/brand-assets.zip" target="_blank" className="text-neon-blue text-sm hover:underline">
                            Download Brand Assets (Coming Soon)
                        </a>
                    </div>
                </div>
            </motion.div>
        ),
        contact: (
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="space-y-8"
            >
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">Contact Us</h1>
                <p className="text-sm sm:text-base text-gray-500 leading-relaxed">
                    We’re here to help you unlock the full potential of Xynapse Analytics. Reach out with questions, feedback, or partnership inquiries, and our team will respond promptly.
                </p>
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">General Inquiries</h3>
                        <p className="text-sm text-gray-500">
                            Have questions about our platform or need assistance? Contact our support team.
                        </p>
                        <a href="mailto:mail.xynapse@gmail.com" className="text-neon-blue text-sm hover:underline">
                            Email: mail.xynapse@gmail.com
                        </a>
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2">Join Our Community</h3>
                        <p className="text-sm text-gray-500">
                            Connect with the Xynapse community on X and Discord to share insights and stay updated.
                        </p>
                        <div className="flex gap-4">
                            <Link href="https://x.com/xynapseai_" target="_blank" className="text-neon-blue text-sm hover:underline">
                                X Community
                            </Link>
                            <Link href="https://discord.gg/wrCznU5b2y" target="_blank" className="text-neon-blue text-sm hover:underline">
                                Discord Community
                            </Link>
                        </div>
                    </div>
                </div>
            </motion.div>
        ),
    }

    return (
        <div className="min-h-screen flex flex-col bg-black text-white font-saira">
            {/* Header - Fix: Set fixed height for consistent offset */}
            <header className="w-full h-20 py-2 px-6 flex justify-between items-center z-50 sticky top-0 bg-black/50 backdrop-blur-lg">
                <div className="flex items-center">
                    <Link href="/">
                        <Image
                            src="/logos/logo-landscape.webp"
                            alt="Xynapse Analytics Logo"
                            width={120}
                            height={56}
                            className="h-16 w-auto"
                            priority
                        />
                    </Link>
                </div>
                <div className="flex items-center gap-4">
                    <div>
                        <button
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            className="text-white text-[9px] font-medium transition-all duration-300 relative w-6 h-6"
                            aria-label="Toggle mobile menu"
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
                    className="fixed inset-0 bg-black/50 rounded-l-xl z-50"
                    onClick={() => setIsMobileMenuOpen(false)}
                >
                    <motion.div
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="fixed right-0 top-0 w-80 max-w-sm h-full bg-black/80 backdrop-blur-sm border-l border-white/10 rounded-l-xl p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => setIsMobileMenuOpen(false)}
                            className="text-white text-xl font-bold mb-6"
                            aria-label="Close mobile menu"
                        >
                            ✕
                        </button>
                        <div className="space-y-4">
                            {menuItems.map((item) => (
                                <button
                                    key={item.name}
                                    onClick={() => {
                                        if (!item.disabled) {
                                            setActiveSection(item.id)
                                            router.push(item.href, undefined, { shallow: true })
                                            setIsMobileMenuOpen(false)
                                        }
                                    }}
                                    className={`block w-full text-left text-xs font-medium transition-all duration-300 rounded-lg px-4 py-2 ${item.disabled
                                        ? "text-gray-500 cursor-not-allowed"
                                        : activeSection === item.id
                                            ? "text-white bg-white/10"
                                            : "text-gray-500 hover:text-white hover:bg-white/5"
                                        }`}
                                    disabled={item.disabled}
                                >
                                    {item.name}
                                </button>
                            ))}
                            <div className="flex gap-6 pt-4">
                                <Link href="https://x.com/xynapseai_" target="_blank" className="text-gray-500 hover:text-white transition-colors">
                                    <Image
                                        src="/logos/x.webp"
                                        alt="X Logo"
                                        width={24}
                                        height={24}
                                        className="h-5 w-auto"
                                    />
                                </Link>
                                <Link href="https://discord.gg/wrCznU5b2y" target="_blank" className="text-gray-500 hover:text-white transition-colors">
                                    <Image
                                        src="/logos/discord.webp"
                                        alt="Discord Logo"
                                        width={24}
                                        height={24}
                                        className="h-5 w-auto"
                                    />
                                </Link>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* Main Content - Fix: Remove flex-row, add pl-[20%] on md for shift, keep w-full */}
            <div className="min-h-screen">
                <main className="w-full p-6 overflow-y-auto">
                    <div className="max-w-4xl mx-auto">
                        {sectionContent[activeSection]}
                    </div>
                </main>
            </div>

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
                        <div>
                            <h3 className="text-sm font-bold text-white mb-4 tracking-wider">PRODUCT</h3>
                            {[
                                { name: "Features", href: "/docs#features", disabled: false },
                                { name: "Pricing (Soon)", href: "#", disabled: true },
                                { name: "API (Soon)", href: "#", disabled: true },
                            ].map((link) => (
                                <Link
                                    key={link.name}
                                    href={link.href}
                                    target={link.disabled ? "_self" : "_blank"}
                                    className={`block text-xs mb-2 transition-all duration-300 ${link.disabled
                                        ? "text-gray-600 cursor-not-allowed"
                                        : "text-gray-500 hover:text-white"
                                        }`}
                                >
                                    {link.name}
                                </Link>
                            ))}
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white mb-4 tracking-wider">RESOURCES</h3>
                            {[
                                { name: "About", href: "/docs#about", disabled: false },
                                { name: "Brand Kit", href: "/docs#brandkit", disabled: false },
                                { name: "Contact", href: "/docs#contact", disabled: false },
                                { name: "Docs", href: "/docs#docs", disabled: false },
                            ].map((link) => (
                                <Link
                                    key={link.name}
                                    href={link.href}
                                    target="_blank"
                                    className="block text-xs text-gray-500 mb-2 transition-all duration-300 hover:text-white"
                                >
                                    {link.name}
                                </Link>
                            ))}
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white mb-4 tracking-wider">CONTACT</h3>
                            <a
                                href="mailto:mail.xynapse@gmail.com"
                                className="block text-xs text-gray-500 mb-2 transition-all duration-300 hover:text-white"
                            >
                                Email : mail.xynapse@gmail.com
                            </a>
                        </div>
                    </div>
                    <div className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-white/20">
                        <div className="flex gap-6 mb-4 md:mb-0">
                            <Link href="https://x.com/xynapseai_" target="_blank" className="text-gray-500 hover:text-white transition-colors">
                                <Image
                                    src="/logos/x.webp"
                                    alt="X Logo"
                                    width={24}
                                    height={24}
                                    className="h-5 sm:h-6 w-auto"
                                />
                            </Link>
                            <Link href="https://discord.gg/wrCznU5b2y" target="_blank" className="text-gray-500 hover:text-white transition-colors">
                                <Image
                                    src="/logos/discord.webp"
                                    alt="Discord Logo"
                                    width={24}
                                    height={24}
                                    className="h-5 sm:h-6 w-auto"
                                />
                            </Link>
                        </div>
                        <div className="flex gap-6 text-xs text-gray-500">
                            <button
                                onClick={() => openModal('terms')}
                                className="hover:text-white transition-colors"
                            >
                                Terms
                            </button>
                            <button
                                onClick={() => openModal('privacy')}
                                className="hover:text-white transition-colors"
                            >
                                Privacy
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
            `}</style>
        </div>
    )
}