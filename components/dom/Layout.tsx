'use client'

import { ReactNode, useRef } from 'react'
import dynamic from 'next/dynamic'

// Render the R3F canvas only on the client, preventing SSR warnings.
const Scene = dynamic(() => import('../canvas/Scene'), { ssr: false })

const Layout = ({ children }: { children: ReactNode }) => {
  const ref = useRef(null)

  // The wrapper provides a scrollable surface while forwarding pointer events to the canvas.
  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width: ' 100%',
        height: '100%',
        overflow: 'auto',
        touchAction: 'auto',
      }}
    >
      {children}
      <Scene
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
        }}
        eventSource={ref}
        eventPrefix='client'
      />
    </div>
  )
}

export default Layout
