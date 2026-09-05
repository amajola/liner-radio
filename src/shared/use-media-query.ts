import { useEffect, useState } from "react";

/**
 * Layout that differs by more than styling has to be decided in JS. Used to
 * move the lobby's entry forms into a modal on small screens, where two full
 * cards would push the room and library panels off a fixed, non-scrolling page.
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    // Re-read on resize as well as on `change`: some embedded and emulated
    // viewports resize without dispatching the media query event, which would
    // otherwise leave the layout stuck in the wrong mode. React bails out when
    // the value is unchanged, so the extra listener costs nothing.
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    return () => {
      list.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, [query]);

  return matches;
}
