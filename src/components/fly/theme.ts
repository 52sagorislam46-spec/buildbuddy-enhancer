import { useEffect, useState } from "react";

const KEY = "app_theme";

export function applyTheme(dark: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", dark);
}

export function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === "dark";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    applyTheme(dark);
    try {
      localStorage.setItem(KEY, dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, [dark]);

  return { dark, setDark, toggle: () => setDark((d) => !d) };
}
