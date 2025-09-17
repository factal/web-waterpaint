import tunnel from 'tunnel-rat'

// tunnel-rat creates a shared portal so DOM and R3F trees can exchange children.
const r3f = tunnel()

export default r3f
