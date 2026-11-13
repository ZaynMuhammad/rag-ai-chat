"use client";

import { useEffect } from "react";
import { revealPassage } from "./Article";

const passageIdIn = (hash: string) => {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
};

export function RevealHashPassage() {
  useEffect(() => {
    if (window.location.hash === "") return;
    revealPassage(document.getElementById(passageIdIn(window.location.hash)));
  }, []);
  return null;
}
