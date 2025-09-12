"use client"

import { motion } from "framer-motion"

export function GlassCard({ children, className = "", delay = 0, variant = "default" }) {
  const variants = {
    default: `
      backdrop-blur-xl bg-white/5 border border-white/10 
      hover:bg-white/10 hover:border-white/20
    `,
    premium: `
      backdrop-blur-2xl bg-gradient-to-br from-white/10 via-white/5 to-transparent 
      border border-white/20 hover:from-white/15 hover:via-white/8 hover:to-white/5
      shadow-2xl hover:shadow-blue-500/10
    `,
    minimal: `
      backdrop-blur-md bg-white/3 border border-white/5 
      hover:bg-white/5 hover:border-white/10
    `,
    interactive: `
      backdrop-blur-xl bg-white/5 border border-white/10 
      hover:bg-white/15 hover:border-blue-400/30 hover:shadow-lg hover:shadow-blue-500/20
      cursor-pointer
    `,
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.8, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      viewport={{ once: true }}
      whileHover={variant === "interactive" ? { scale: 1.02, y: -5 } : undefined}
      className={`
        relative rounded-3xl p-8 transition-all duration-500 group overflow-hidden
        ${variants[variant]}
        ${className}
      `}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div className="absolute top-0 left-0 w-full h-1/3 bg-gradient-to-b from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
      <div className="absolute bottom-0 right-0 w-1/3 h-full bg-gradient-to-l from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-blue-500/20 via-cyan-500/20 to-blue-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm -z-10" />
      <div className="relative z-10">{children}</div>
    </motion.div>
  )
}

export function GlassNavigation({ items, activeItem, onItemClick }) {
  return (
    <motion.nav
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="backdrop-blur-2xl bg-black/60 border border-white/20 rounded-2xl p-2 flex gap-2"
    >
      {items.map((item, index) => (
        <motion.button
          key={item}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => onItemClick?.(item)}
          className={`
            px-4 py-2 rounded-xl transition-all duration-300 relative overflow-hidden font-medium
            ${activeItem === item ? "bg-blue-600/80 border border-blue-400/60" : "hover:bg-gray-800/60"}
          `}
        >
          <span className="relative z-10 font-medium text-white">{item}</span>
          {activeItem === item && (
            <motion.div
              layoutId="activeTab"
              className="absolute inset-0 bg-gradient-to-r from-blue-500/40 to-cyan-500/40 rounded-xl"
              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
            />
          )}
        </motion.button>
      ))}
    </motion.nav>
  )
}

export function GlassModal({ isOpen, onClose, children, title }) {
  if (!isOpen) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="relative max-w-2xl w-full max-h-[80vh] overflow-auto backdrop-blur-2xl bg-white/10 border border-white/20 rounded-3xl p-8 shadow-2xl"
      >
        {title && (
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-white">{title}</h2>
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full"
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </motion.div>
    </motion.div>
  )
}

export function GlassButton({ children, variant = "default", size = "md", onClick, className = "", disabled = false }) {
  const variants = {
    default: "backdrop-blur-xl bg-gray-800/80 border border-gray-600/50 text-white hover:bg-gray-700/80",
    primary:
      "backdrop-blur-xl bg-gradient-to-r from-blue-600/90 to-cyan-600/90 border border-blue-400/50 text-white hover:from-blue-500 hover:to-cyan-500",
    secondary:
      "backdrop-blur-xl bg-gray-800/60 border border-gray-600/40 text-white hover:text-white hover:bg-gray-700/70",
    ghost: "backdrop-blur-md bg-transparent border border-transparent text-white hover:text-white hover:bg-gray-800/40",
  }

  const sizes = {
    sm: "px-4 py-2 text-sm",
    md: "px-6 py-3 text-base",
    lg: "px-8 py-4 text-lg",
  }

  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      onClick={onClick}
      disabled={disabled}
      className={`
        relative rounded-2xl font-medium transition-all duration-300 group overflow-hidden
        ${variants[variant]}
        ${sizes[size]}
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        ${className}
      `}
    >
      <span className="relative z-10 flex items-center gap-2 text-white">{children}</span>
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-white/10 via-transparent to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
    </motion.button>
  )
}

export function GlassInput({ placeholder, value, onChange, type = "text", className = "" }) {
  return (
    <div className={`relative ${className}`}>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full px-4 py-3 backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl text-white placeholder-white/50 focus:outline-none focus:border-blue-400/50 focus:bg-white/10 transition-all duration-300"
      />
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-500/10 via-transparent to-cyan-500/10 opacity-0 focus-within:opacity-100 transition-opacity duration-300 pointer-events-none" />
    </div>
  )
}

export function GlassTooltip({ children, content, position = "top" }) {
  return (
    <div className="relative group">
      {children}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        whileHover={{ opacity: 1, scale: 1 }}
        className={`
          absolute z-50 px-3 py-2 backdrop-blur-xl bg-black/80 border border-white/20 
          rounded-xl text-white text-sm whitespace-nowrap pointer-events-none
          opacity-0 group-hover:opacity-100 transition-all duration-300
          ${position === "top" ? "-top-12 left-1/2 -translate-x-1/2" : ""}
          ${position === "bottom" ? "-bottom-12 left-1/2 -translate-x-1/2" : ""}
          ${position === "left" ? "top-1/2 -translate-y-1/2 -left-3 -translate-x-full" : ""}
          ${position === "right" ? "top-1/2 -translate-y-1/2 -right-3 translate-x-full" : ""}
        `}
      >
        {content}
        <div
          className={`
          absolute w-2 h-2 bg-black/80 border-l border-t border-white/20 rotate-45
          ${position === "top" ? "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2" : ""}
          ${position === "bottom" ? "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2" : ""}
          ${position === "left" ? "right-0 top-1/2 -translate-y-1/2 translate-x-1/2" : ""}
          ${position === "right" ? "left-0 top-1/2 -translate-y-1/2 -translate-x-1/2" : ""}
        `}
        />
      </motion.div>
    </div>
  )
}