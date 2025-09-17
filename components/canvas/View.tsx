import { forwardRef, Suspense, useImperativeHandle, useRef, ReactNode, HTMLAttributes } from 'react'
import { OrbitControls, PerspectiveCamera, View as ViewImpl } from '@react-three/drei'
import Three from '../helpers/Three'

type CommonProps = {
  color?: string
}

// Common sets up the default camera and lighting for any scene rendered in a View.
export const Common = ({ color }: CommonProps) => (
  <Suspense fallback={null}>
    {color && <color attach='background' args={[color]} />}
    <ambientLight />
    <pointLight position={[20, 30, 10]} intensity={3} decay={0.2} />
    <pointLight position={[-10, -10, -10]} color='blue' decay={0.2} />
    <PerspectiveCamera makeDefault fov={40} position={[0, 0, 6]} />
  </Suspense>
)

type ViewProps = {
  children?: ReactNode
  orbit?: boolean
} & HTMLAttributes<HTMLDivElement>

// View splits a DOM element and an R3F <View>, keeping both references in sync.
const View = forwardRef<HTMLDivElement, ViewProps>(({ children, orbit, ...props }, ref) => {
  const localRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => localRef.current as HTMLDivElement)

  return (
    <>
      <div ref={localRef} {...props} />
      <Three>
        <ViewImpl track={localRef as React.RefObject<HTMLElement>}>
          {children}
          {orbit && <OrbitControls />}
        </ViewImpl>
      </Three>
    </>
  )
})

View.displayName = 'View'

export default View
