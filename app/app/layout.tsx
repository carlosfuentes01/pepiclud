import "./globals.css";

export const metadata = { title: "PepiCloud – Gestión documental" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
