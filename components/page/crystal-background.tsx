'use client'

import { useEffect, useRef } from 'react'

interface Node {
    x: number
    y: number
    originalX: number
    originalY: number
    offsetX: number
    offsetY: number
    opacity: number
}

export default function CrystalBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const nodesRef = useRef<Node[]>([])
    const mousePosRef = useRef({ x: 0, y: 0 })

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const setupCanvas = () => {
            canvas.width = window.innerWidth
            canvas.height = window.innerHeight
            nodesRef.current = []

            const spacing = 45
            const hexRadius = spacing / Math.sqrt(3)

            const cols = 14
            const rows = 25
            const startX = canvas.width - cols * spacing + 50
            const startY = -50

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const x = startX + c * spacing + (r % 2 === 0 ? 0 : spacing / 2)
                    const y = startY + r * (hexRadius * 1.5)

                    nodesRef.current.push({
                        x,
                        y,
                        originalX: x,
                        originalY: y,
                        offsetX: 0,
                        offsetY: 0,
                        opacity: 0.1,
                    })
                }
            }
        }

        setupCanvas()
        window.addEventListener('resize', setupCanvas)

        const handleMouseMove = (e: MouseEvent) => {
            mousePosRef.current = { x: e.clientX, y: e.clientY }
        }
        window.addEventListener('mousemove', handleMouseMove)

        let animationId: number

        const animate = () => {
            ctx.fillStyle = '#000000'
            ctx.fillRect(0, 0, canvas.width, canvas.height)

            const { x: mX, y: mY } = mousePosRef.current
            const influenceRadius = 200

            nodesRef.current.forEach((node) => {
                const dx = mX - node.originalX
                const dy = mY - node.originalY
                const distance = Math.sqrt(dx * dx + dy * dy)

                if (distance < influenceRadius) {
                    const power = 1 - distance / influenceRadius
                    const force = power * 25
                    const angle = Math.atan2(dy, dx)

                    node.offsetX = Math.cos(angle) * -force
                    node.offsetY = Math.sin(angle) * -force
                    node.opacity = 0.2 + power * 0.6
                } else {
                    node.offsetX *= 0.92
                    node.offsetY *= 0.92
                    node.opacity += (0.1 - node.opacity) * 0.05
                }

                node.x = node.originalX + node.offsetX
                node.y = node.originalY + node.offsetY
            })

            ctx.lineWidth = 0.8
            for (let i = 0; i < nodesRef.current.length; i++) {
                const nodeA = nodesRef.current[i]

                for (let j = i + 1; j < nodesRef.current.length; j++) {
                    const nodeB = nodesRef.current[j]
                    const distSq = Math.pow(nodeA.x - nodeB.x, 2) + Math.pow(nodeA.y - nodeB.y, 2)

                    if (distSq < Math.pow(50, 2)) {
                        const avgOpacity = (nodeA.opacity + nodeB.opacity) / 2
                        ctx.strokeStyle = `rgba(100, 200, 255, ${avgOpacity * 0.4})`
                        ctx.beginPath()
                        ctx.moveTo(nodeA.x, nodeA.y)
                        ctx.lineTo(nodeB.x, nodeB.y)
                        ctx.stroke()
                    }
                }
            }

            nodesRef.current.forEach((node) => {
                const size = node.opacity * 3

                ctx.fillStyle = `rgba(255, 255, 255, ${node.opacity + 0.2})`
                ctx.beginPath()
                ctx.arc(node.x, node.y, size / 2, 0, Math.PI * 2)
                ctx.fill()

                if (node.opacity > 0.3) {
                    const gradient = ctx.createRadialGradient(
                        node.x,
                        node.y,
                        0,
                        node.x,
                        node.y,
                        size * 4,
                    )
                    gradient.addColorStop(0, `rgba(6, 182, 212, ${node.opacity * 0.3})`)
                    gradient.addColorStop(1, 'rgba(6, 182, 212, 0)')
                    ctx.fillStyle = gradient
                    ctx.beginPath()
                    ctx.arc(node.x, node.y, size * 4, 0, Math.PI * 2)
                    ctx.fill()
                }
            })

            animationId = requestAnimationFrame(animate)
        }

        animate()

        return () => {
            window.removeEventListener('resize', setupCanvas)
            window.removeEventListener('mousemove', handleMouseMove)
            cancelAnimationFrame(animationId)
        }
    }, [])

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ background: '#000000' }}
        />
    )
}
