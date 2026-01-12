'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isMobileMenuOpen])

  return (
    <>
      <header className="relative z-20 px-8 py-3 border-b border-white/10 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center">
            <Image
              src="/logos/logo-landscape.webp"
              alt="Chain Lens Logo"
              width={180}
              height={56}
              className="h-12 sm:h-16 w-auto"
              priority
            />
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-10">
            {/* Product Dropdown */}
            <div className="relative group">
              <button className="text-white/70 hover:text-white transition-colors text-sm tracking-wider py-2">
                PRODUCT
              </button>
              <div className="absolute top-full left-1/2 -translate-x-1/2 w-30 bg-black/90 backdrop-blur-md border border-white/10 rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 transform origin-top group-hover:translate-y-0 translate-y-2 pointer-events-none group-hover:pointer-events-auto">
                <div className="py-3">
                  <Link
                    href="/docs#about"
                    className="block px-6 py-2 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    About
                  </Link>
                  <Link
                    href="/docs#features"
                    className="block px-6 py-2 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    Features
                  </Link>
                  <span className="block px-6 py-2 text-xs text-white/40 cursor-not-allowed">
                    Pricing (Soon)
                  </span>
                  <span className="block px-6 py-2 text-xs text-white/40 cursor-not-allowed">
                    API (Soon)
                  </span>
                </div>
              </div>
            </div>

            {/* Resources Dropdown */}
            <div className="relative group">
              <button className="text-white/70 hover:text-white transition-colors text-sm tracking-wider py-2">
                RESOURCES
              </button>
              <div className="absolute top-full left-1/2 -translate-x-1/2  w-32 bg-black/90 backdrop-blur-md border border-white/10 rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 transform origin-top group-hover:translate-y-0 translate-y-2 pointer-events-none group-hover:pointer-events-auto">
                <div className="py-3">
                  <Link
                    href="/docs#brandkit"
                    className="block px-6 py-2 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    Brand Kit
                  </Link>
                  <Link
                    href="/docs#contact"
                    className="block px-6 py-2 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    Contact
                  </Link>
                  <Link
                    href="/docs#docs"
                    className="block px-6 py-2 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    Docs
                  </Link>
                </div>
              </div>
            </div>
          </nav>

          {/* Mobile Menu Button (Hamburger) */}
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="md:hidden text-white p-1 hover:text-primary transition-colors"
            aria-label="Open menu"
          >
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
      </header>

      <div
        className={`fixed inset-0 z-50 md:hidden transition-all duration-500 ${
          isMobileMenuOpen ? 'visible' : 'invisible delay-500'
        }`}
      >
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-500 ease-in-out ${
            isMobileMenuOpen ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={() => setIsMobileMenuOpen(false)}
        />

        <div
          className={`absolute right-0 top-0 h-full w-80 bg-[#111] border-l border-white/10 shadow-2xl transform transition-transform duration-500 cubic-bezier(0.32, 0.72, 0, 1) ${
            isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex justify-end p-6">
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-white/70 hover:text-white transition-colors p-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="px-8 pb-8 space-y-10 overflow-y-auto h-[calc(100%-80px)]">
            {/* Group 1 */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-primary tracking-widest uppercase border-b border-white/10 pb-2">
                Product
              </h3>
              <div className="flex flex-col space-y-3">
                <Link
                  href="/docs#about"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-lg text-white/80 hover:text-white hover:translate-x-2 transition-all duration-300"
                >
                  About
                </Link>
                <Link
                  href="/docs#features"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-lg text-white/80 hover:text-white hover:translate-x-2 transition-all duration-300"
                >
                  Features
                </Link>
                <span className="text-lg text-white/30 cursor-not-allowed">Pricing (Soon)</span>
                <span className="text-lg text-white/30 cursor-not-allowed">API (Soon)</span>
              </div>
            </div>

            {/* Group 2 */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-primary tracking-widest uppercase border-b border-white/10 pb-2">
                Resources
              </h3>
              <div className="flex flex-col space-y-3">
                <Link
                  href="/docs#brandkit"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-lg text-white/80 hover:text-white hover:translate-x-2 transition-all duration-300"
                >
                  Brand Kit
                </Link>
                <Link
                  href="/docs#contact"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-lg text-white/80 hover:text-white hover:translate-x-2 transition-all duration-300"
                >
                  Contact
                </Link>
                <Link
                  href="/docs#docs"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-lg text-white/80 hover:text-white hover:translate-x-2 transition-all duration-300"
                >
                  Docs
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
