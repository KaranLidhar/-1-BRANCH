export const metadata = {
  title: 'Branch Ops',
  description: 'Truck fleet yard operations',
}
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  )
}
