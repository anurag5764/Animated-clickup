import "./globals.css";

export const metadata = {
  title: "PS Team Workflow Tracker",
  description: "Real-time animated workflow dashboard for PS team task tracking and stage analysis.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full min-h-0">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased h-full min-h-0 overflow-hidden">
        {children}
      </body>
    </html>
  );
}
