export type Theme = "light" | "dark";

export const themeStorageKey = "theme";

export const applyStoredThemeScript = `try{var t=localStorage.getItem("${themeStorageKey}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
