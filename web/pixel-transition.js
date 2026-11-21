// DOM adaptation of React Bits PixelTransition (random / square / pop).
// Source: David Haz, https://reactbits.dev/animations/pixel-transition
// License: /licenses/react-bits.txt
export function pixelStage(image) {
  const surface = document.createElement("span");
  surface.className = "pixel-stage";
  image.replaceWith(surface);
  const mask = document.createElement("canvas");
  mask.width = mask.height = 16;
  mask.setAttribute("aria-hidden", "true");
  surface.append(image, mask);
  const ctx = mask.getContext("2d");
  let frame = 0,
    revision = 0;
  return async (url, animate = true) => {
    const token = ++revision;
    cancelAnimationFrame(frame);
    ctx?.clearRect(0, 0, 16, 16);
    const next = new Image();
    next.src = url;
    try {
      await next.decode();
    } catch {
      return;
    }
    if (token !== revision || !surface.isConnected) return;
    if (
      !ctx ||
      !animate ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      image.src = url;
      return;
    }
    const delays = Array.from({ length: 256 }, () => Math.random());
    const color = getComputedStyle(surface).getPropertyValue("--key");
    const start = performance.now();
    let swapped = false;
    function paint(now) {
      if (!surface.isConnected || token !== revision) return;
      const progress = Math.min(1, (now - start) / 560);
      const covering = progress < 0.5;
      const phase = covering ? progress * 2 : progress * 2 - 1;
      if (!covering && !swapped) {
        image.src = url;
        swapped = true;
      }
      ctx.clearRect(0, 0, 16, 16);
      ctx.fillStyle = color;
      for (let i = 0; i < 256; i++) {
        if (phase >= delays[i] === covering) ctx.fillRect(i % 16, i >> 4, 1, 1);
      }
      if (progress < 1) frame = requestAnimationFrame(paint);
    }
    frame = requestAnimationFrame(paint);
  };
}
