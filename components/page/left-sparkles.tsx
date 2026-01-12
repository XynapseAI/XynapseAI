'use client'

import { useEffect, useRef } from 'react'

interface Point {
  x: number
  y: number
  z: number
  originX: number
  originY: number
  originZ: number
  type: 'dot' | 'crystal'
  size: number
}

export default function SphericalCluster() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: 0, y: 0 })

  const CONFIG = {
    particleCount: 35,
    sphereRadius: 220,
    rotationSpeed: 0.01,
    connectionDistance: 110,
    perspective: 800,
    centerShiftX: -320,
    mobileCenterShiftX: -50,
    mouseSensitivity: 0.0002,
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0
    let points: Point[] = []
    let animationId: number
    let currentShiftX = CONFIG.centerShiftX

    let rotationX = 0
    let rotationY = 0

    // Target rotation
    let targetRotationX = 0
    let targetRotationY = 0

    const initPoints = () => {
      points = []
      for (let i = 0; i < CONFIG.particleCount; i++) {
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(Math.random() * 2 - 1)
        const r = CONFIG.sphereRadius * Math.cbrt(Math.random())

        const x = r * Math.sin(phi) * Math.cos(theta)
        const y = r * Math.sin(phi) * Math.sin(theta)
        const z = r * Math.cos(phi)

        const isCrystal = Math.random() > 0.65

        points.push({
          x,
          y,
          z,
          originX: x,
          originY: y,
          originZ: z,
          type: isCrystal ? 'crystal' : 'dot',
          size: isCrystal ? 2.5 + Math.random() * 2 : 1.5 + Math.random(),
        })
      }
    }

    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1
      width = window.innerWidth
      height = window.innerHeight

      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`

      ctx.scale(dpr, dpr)

      if (width < 768) {
        // Mobile breakpoint
        currentShiftX = CONFIG.mobileCenterShiftX
      } else {
        currentShiftX = CONFIG.centerShiftX
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX
      mouseRef.current.y = e.clientY
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)

      const cx = width / 2 + currentShiftX
      const cy = height / 2

      // 2. Logic & Mouse Hover
      const mouseXRel = mouseRef.current.x - width / 2
      const mouseYRel = mouseRef.current.y - height / 2

      targetRotationY = mouseXRel * CONFIG.mouseSensitivity
      targetRotationX = mouseYRel * CONFIG.mouseSensitivity

      rotationY += CONFIG.rotationSpeed + (targetRotationY - rotationY) * 0.05
      rotationX += (targetRotationX - rotationX) * 0.05

      const cosY = Math.cos(rotationY)
      const sinY = Math.sin(rotationY)
      const cosX = Math.cos(rotationX)
      const sinX = Math.sin(rotationX)

      points.forEach((p) => {
        let x1 = p.originX * cosY - p.originZ * sinY
        let z1 = p.originZ * cosY + p.originX * sinY

        let y2 = p.originY * cosX - z1 * sinX
        let z2 = z1 * cosX + p.originY * sinX

        p.x = x1
        p.y = y2
        p.z = z2
      })

      points.sort((a, b) => b.z - a.z)

      ctx.lineWidth = 0.5

      for (let i = 0; i < points.length; i++) {
        const p1 = points[i]
        for (let j = i + 1; j < points.length; j++) {
          const p2 = points[j]

          const dx = p1.x - p2.x
          const dy = p1.y - p2.y
          const dz = p1.z - p2.z
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

          if (dist < CONFIG.connectionDistance) {
            const alpha = 1 - dist / CONFIG.connectionDistance

            const scale1 = CONFIG.perspective / (CONFIG.perspective + p1.z)
            const scale2 = CONFIG.perspective / (CONFIG.perspective + p2.z)

            if (scale1 > 0 && scale2 > 0) {
              ctx.beginPath()
              ctx.strokeStyle = `rgba(200, 230, 255, ${alpha * 0.35})`
              ctx.moveTo(cx + p1.x * scale1, cy + p1.y * scale1)
              ctx.lineTo(cx + p2.x * scale2, cy + p2.y * scale2)
              ctx.stroke()
            }
          }
        }
      }

      points.forEach((p) => {
        const scale = CONFIG.perspective / (CONFIG.perspective + p.z)
        if (scale <= 0) return

        const screenX = cx + p.x * scale
        const screenY = cy + p.y * scale
        const currentSize = p.size * scale

        if (p.type === 'crystal') {
          ctx.save()
          ctx.translate(screenX, screenY)
          ctx.rotate(Math.PI / 4)

          ctx.fillStyle = `rgba(230, 245, 255, ${0.4 + scale * 0.3})`
          ctx.shadowBlur = 12 * scale
          ctx.shadowColor = 'rgba(180, 220, 255, 0.6)'

          ctx.beginPath()
          ctx.rect(-currentSize, -currentSize, currentSize * 2, currentSize * 2)
          ctx.fill()

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
          ctx.lineWidth = 0.5
          ctx.stroke()
          ctx.restore()
        } else {
          ctx.beginPath()
          ctx.arc(screenX, screenY, currentSize * 0.8, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
          ctx.shadowBlur = 8 * scale
          ctx.shadowColor = 'white'
          ctx.fill()
        }
      })

      animationId = requestAnimationFrame(draw)
    }

    handleResize()
    initPoints()
    draw()

    window.addEventListener('resize', handleResize)
    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('mousemove', handleMouseMove)
      cancelAnimationFrame(animationId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ background: 'transparent' }}
    />
  )
}
