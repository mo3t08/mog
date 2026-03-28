import type { Metadata } from "next";
import { Oswald, Roboto } from "next/font/google";
import "./globals.css";

const oswald = Oswald({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const roboto = Roboto({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MOG Barbería — Reserva tu cita",
  description: "Reserva tu corte en MOG Barbería.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"
        />
      </head>
      <body className={`${oswald.variable} ${roboto.variable}`}>{children}</body>
    </html>
  );
}