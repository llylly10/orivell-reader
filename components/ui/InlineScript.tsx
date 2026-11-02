"use client";

/**
 * An inline script that React may also render on the client (recovery after a
 * hydration failure regenerates the whole tree, including the head). A script
 * created by the client renderer never executes, and React logs an error every
 * time one is created with an executable type. So the type switches: the
 * server render says "text/javascript" and the browser runs the script while
 * still parsing the HTML; every client render says "text/plain", a data block
 * React knows never to execute. `suppressHydrationWarning` covers the type
 * differing between the two renders. Pattern from the Next.js guide
 * "Preventing flash before hydration".
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
