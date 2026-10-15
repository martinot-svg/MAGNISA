"use client";

import {useEffect} from "react";

/**
 * Progressive enhancement: the page remains fully visible without JavaScript.
 * Observed content only animates if IntersectionObserver and motion are allowed.
 */
export function LandingMotion(){
  useEffect(()=>{
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if(reduced.matches || !("IntersectionObserver" in window)) return;
    const targets = Array.from(document.querySelectorAll<HTMLElement>(".landing .motion-reveal"));
    const observer = new IntersectionObserver((entries)=>{
      for(const entry of entries){
        if(!entry.isIntersecting) continue;
        entry.target.classList.add("motion-visible");
        observer.unobserve(entry.target);
      }
    },{threshold:0.08,rootMargin:"0px 0px -32px 0px"});
    for(const node of targets){
      if(node.getBoundingClientRect().top < window.innerHeight + 24){
        node.classList.add("motion-visible");
      }else{
        node.classList.add("motion-pending");
        observer.observe(node);
      }
    }
    return ()=>observer.disconnect();
  },[]);
  return null;
}
