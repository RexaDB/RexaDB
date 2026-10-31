export const APP_ICON_PRESETS = [
  { id: "default", label: "RexaDB" },
  { id: "halloween", label: "Halloween" },
  { id: "mummy", label: "Mummy" },
  { id: "skeleton", label: "Skeleton" },
] as const;

export const CUSTOM_APP_ICON_ID = "custom";

const ICON_SIZE = 1024;
// The macOS Dock draws an icon as given, so a custom image has to carry the
// same margin and corners as every other icon on the grid.
const MAC_TILE_INSET = 100;
const MAC_TILE_RADIUS = 185;

export interface AppIconState {
  selected: string;
  hasCustom: boolean;
}

/** The centered square of an image, which is what a custom icon shows. */
export function coverCrop(width: number, height: number) {
  const size = Math.min(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

export async function getAppIcon() {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AppIconState>("get_app_icon");
}

export async function setAppIcon(id: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_app_icon", { id });
}

export async function getCustomAppIconBlob() {
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke<ArrayBuffer>("get_custom_app_icon");
  return new Blob([bytes], { type: "image/png" });
}

export async function renderCustomAppIcon(file: Blob, mac: boolean) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare the image.");

  const inset = mac ? MAC_TILE_INSET : 0;
  const tile = ICON_SIZE - inset * 2;
  if (mac) {
    context.beginPath();
    context.roundRect(inset, inset, tile, tile, MAC_TILE_RADIUS);
    context.clip();
  }
  const crop = coverCrop(bitmap.width, bitmap.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, inset, inset, tile, tile);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not prepare the image."))),
      "image/png",
    );
  });
}

export async function setCustomAppIcon(png: Blob) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_custom_app_icon", new Uint8Array(await png.arrayBuffer()), {
    headers: { "Content-Type": "application/octet-stream" },
  });
}
