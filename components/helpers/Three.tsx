import { ReactNode } from 'react'
import r3f from './r3f'

// Three injects children into the shared R3F tunnel from within the React tree.
const Three = ({ children }: { children: ReactNode }) => {
  return <r3f.In>{children}</r3f.In>
}

export default Three
