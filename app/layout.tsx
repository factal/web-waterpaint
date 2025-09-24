import type { Metadata } from 'next'
import Layout from '@/components/dom/Layout'
import './globals.css'

export const metadata: Metadata = {
  title: 'Web Water Paint',
  description: 'Web Water Paint',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en'>
      <body className='antialiased dark'>
        <Layout>{children}</Layout>
      </body>
    </html>
  )
}
