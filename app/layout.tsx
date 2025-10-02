import "./globals.css";
import React from "react";

export const metadata = {
  title: "Comparador de Seguros de Auto (MX)",
  description: "SPA con chat y comparador, conectada a APIs de aseguradoras."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
