export default function Footer() {
  return (
    <footer className="relative z-20 px-4 sm:px-8 py-6 border-t border-white/10 backdrop-blur-sm bg-black/50">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
        <p className="text-white/40 text-xs tracking-wider">© 2026 Xynapse. All rights reserved.</p>
        <div className="flex flex-wrap justify-center gap-4 sm:gap-8 text-xs">
          <a
            href="https://x.com/xynapseai_"
            className="text-white/50 hover:text-white transition-colors"
          >
            Twitter
          </a>
          <a
            href="https://discord.gg/B9kVPpjNvw"
            className="text-white/50 hover:text-white transition-colors"
          >
            Discord
          </a>
          <a
            href="mailto:mail.xynapse@gmail.com"
            className="text-white/50 hover:text-white transition-colors"
          >
            Contact: mail.xynapse@gmail.com
          </a>
          <a href="/docs" className="text-white/50 hover:text-white transition-colors">
            Documentation
          </a>
        </div>
      </div>
    </footer>
  )
}
