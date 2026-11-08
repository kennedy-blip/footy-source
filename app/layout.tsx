import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'FootyPulse Hub — Every match, one heartbeat', description: 'The live football matchday hub. Scores, match rooms, lineups and the latest football news.' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
