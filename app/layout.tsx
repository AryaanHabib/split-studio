import './globals.css';
import Link from 'next/link';
import WorkerStatus from './worker-status';

export const metadata = { title: 'The Split Studio', description: 'Private animated short-form studio' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand"><i style={{ background: 'var(--red)' }} /><i style={{ background: 'var(--blue)' }} />THE SPLIT STUDIO</Link>
          <Link href="/" className="link">Episodes</Link>
          <Link href="/new" className="link">Create</Link>
          <Link href="/publish" className="link">Publish</Link>
          <Link href="/settings" className="link">Settings</Link>
          <span className="spacer" />
          <WorkerStatus />
        </nav>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
