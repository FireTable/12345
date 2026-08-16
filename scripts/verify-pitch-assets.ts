/**
 * Reads the shipped pitch-asset manifest and the source PPTX.
 * Asserts 19 slides, every listed file exists/non-empty, images have
 * width/height > 0, and videos are real MP4 containers (not stubs).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "docs/pitch/ppt/assets");
const manifestPath = join(assetsDir, "manifest.json");
const pptxRel = "docs/pitch/ppt/赢了就回家吃鱼生团队_民声智理_展示材料.pptx";
const VIDEO_MIN_BYTES = 200_000;

type SlideEntry = {
  slide: number;
  title: string;
  type: "image" | "video";
  primary: string;
  files: string[];
  purpose: string;
};

type Manifest = {
  source: string;
  slideCount: number;
  slides: SlideEntry[];
};

function assert(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}

function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function jpegSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    // SOF0 / SOF1 / SOF2
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}

function imageSize(buf: Buffer): { w: number; h: number } | null {
  return pngSize(buf) ?? jpegSize(buf);
}

function isMp4(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  return buf.toString("ascii", 4, 8) === "ftyp";
}

const raw = readFileSync(manifestPath, "utf8");
assert("manifest.json has no _pending_ placeholders", !raw.includes("_pending_"));
const manifest = JSON.parse(raw) as Manifest;

assert("manifest.slideCount is 19", manifest.slideCount === 19, String(manifest.slideCount));
assert("manifest.slides length is 19", manifest.slides.length === 19, String(manifest.slides.length));
assert("manifest.source points at the deck", manifest.source === pptxRel, manifest.source);

const pptxPath = join(root, pptxRel);
assert("source PPTX exists", existsSync(pptxPath), pptxPath);

const zipListing = execFileSync("unzip", ["-Z1", pptxPath], { encoding: "utf8" });
const pptxSlides = zipListing
  .split("\n")
  .filter((line) => /^ppt\/slides\/slide\d+\.xml$/.test(line));
assert(
  "PPTX contains 19 slide XML parts",
  pptxSlides.length === 19,
  `found ${pptxSlides.length}`
);

const seen = new Set<number>();
const originallyMediaLess = new Set([3, 5, 7, 10, 14, 16]);

for (const entry of manifest.slides) {
  const tag = `slide ${String(entry.slide).padStart(2, "0")}`;
  assert(`${tag} index in 1..19`, entry.slide >= 1 && entry.slide <= 19);
  assert(`${tag} not duplicated`, !seen.has(entry.slide));
  seen.add(entry.slide);
  assert(`${tag} has title`, typeof entry.title === "string" && entry.title.trim().length > 0);
  assert(`${tag} has purpose`, typeof entry.purpose === "string" && entry.purpose.trim().length > 0);
  assert(`${tag} files non-empty`, Array.isArray(entry.files) && entry.files.length > 0);
  assert(`${tag} primary listed in files`, entry.files.includes(entry.primary));

  for (const name of entry.files) {
    assert(`${tag} ${name} is not a path escape`, !name.includes("/") && !name.includes("\\"));
    const abs = join(assetsDir, name);
    const st = existsSync(abs) ? statSync(abs) : null;
    assert(`${tag} ${name} exists`, Boolean(st), abs);
    if (!st) continue;
    assert(`${tag} ${name} size > 0`, st.size > 0, `${st.size} bytes`);

    const buf = readFileSync(abs);
    const isPrimary = name === entry.primary;
    if (name.endsWith(".mp4") || (isPrimary && entry.type === "video")) {
      assert(`${tag} ${name} is MP4 (ftyp)`, isMp4(buf));
      assert(
        `${tag} ${name} is large enough to be real footage`,
        st.size >= VIDEO_MIN_BYTES,
        `${st.size} bytes (min ${VIDEO_MIN_BYTES})`
      );
    } else {
      const dim = imageSize(buf);
      assert(
        `${tag} ${name} is a valid bitmap`,
        Boolean(dim && dim.w > 0 && dim.h > 0),
        dim ? `${dim.w}x${dim.h}` : "unreadable"
      );
    }
  }

  if (originallyMediaLess.has(entry.slide)) {
    assert(`${tag} (originally media-less) has a newly prepared file`, entry.files.length >= 1);
  }
}

assert("every slide 1..19 appears once", seen.size === 19);

const slide7 = manifest.slides.find((s) => s.slide === 7);
assert("slide 7 type is video", slide7?.type === "video");
assert(
  "slide 7 primary is an mp4",
  Boolean(slide7?.primary.endsWith(".mp4")),
  slide7?.primary
);

if (process.exitCode) {
  console.error("verify-pitch-assets: FAILED");
} else {
  console.log("verify-pitch-assets: OK");
}
