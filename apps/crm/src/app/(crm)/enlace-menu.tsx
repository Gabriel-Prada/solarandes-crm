"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Enlace del menú que se resalta cuando estás en esa sección.
export function EnlaceMenu({ href, children }: { href: string; children: React.ReactNode }) {
  const activo = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      aria-current={activo ? "page" : undefined}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
        activo ? "bg-amber-100 text-amber-900" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
      }`}
    >
      {children}
    </Link>
  );
}
