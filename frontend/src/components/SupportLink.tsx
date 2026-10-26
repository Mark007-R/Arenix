"use client";

import { useEffect, useState } from "react";
import { useConfig } from "@/lib/config";
import { onPortal } from "@/lib/portal";

/** "Support the game" link to the donation page set on the server (hidden on game portals). */
export function SupportLink({ className = "" }: { className?: string }) {
  const { donate_url } = useConfig();
  const [portal, setPortal] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal is known only in the browser
    setPortal(onPortal());
  }, []);
  if (!donate_url || portal) return null;
  return (
    <a className={`btn btn-ghost ${className}`} href={donate_url} target="_blank" rel="noopener noreferrer">
      ☕ Support ARENIX
    </a>
  );
}
