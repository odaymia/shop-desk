/* Turn a photo the tech just took (a File from a camera/file input) into a
   downscaled JPEG data URL, small enough to store and sync but still clear
   enough to show the customer. Browser-only (Image + canvas). */
export function photoToDataUrl(file, { maxDim = 1400, quality = 0.72 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No photo"));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", quality));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}
