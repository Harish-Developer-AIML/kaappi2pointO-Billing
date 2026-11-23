import Image from "next/image";
import { cn } from "@/lib/utils";

export function Logo({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <Image
      src="/logo.png"
      alt="Kaappi Biller"
      width={size}
      height={size}
      // The Kaappi 2.0 emblem is a dark disc: a faint ring keeps its edge
      // visible against the dark theme's near-black surfaces.
      className={cn("shrink-0 rounded-full object-contain dark:ring-1 dark:ring-white/20", className)}
      priority
    />
  );
}
